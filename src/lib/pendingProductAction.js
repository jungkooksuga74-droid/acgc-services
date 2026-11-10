const STORAGE_KEY = "acgc-pending-product-action";
const REDIRECT_STORAGE_KEY = "acgc-pending-product-redirect";
const STORAGE_VERSION = 1;
const MAX_AGE_MS = 60 * 60 * 1000;

const getStorage = () => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

export const savePendingProductAction = (action) => {
  const storage = getStorage();
  if (!storage || !action?.productId || !["estimate", "direct"].includes(action.actionType)) return null;

  const createdAt = Date.now();
  const id = globalThis.crypto?.randomUUID?.() || `${createdAt}-${Math.random().toString(36).slice(2)}`;
  const pendingAction = {
    ...action,
    id,
    version: STORAGE_VERSION,
    createdAt,
    expiresAt: createdAt + MAX_AGE_MS,
  };

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(pendingAction));
    return pendingAction;
  } catch (error) {
    console.warn("Unable to preserve the pending product action.", error);
    return null;
  }
};

export const getPendingProductAction = () => {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
    if (
      !value ||
      value.version !== STORAGE_VERSION ||
      !value.id ||
      !value.productId ||
      !["estimate", "direct"].includes(value.actionType)
    ) return null;

    const expiresAt = Number(value.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      clearPendingProductAction(value.id);
      return null;
    }
    return value;
  } catch {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore unavailable storage cleanup.
    }
    return null;
  }
};

export const clearPendingProductAction = (expectedId) => {
  const storage = getStorage();
  if (!storage) return;

  try {
    if (!expectedId) {
      storage.removeItem(STORAGE_KEY);
      return;
    }
    const value = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
    if (value?.id === expectedId) storage.removeItem(STORAGE_KEY);
  } catch {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore unavailable storage cleanup.
    }
  }
};

export const updatePendingProductAction = (expectedId, updates) => {
  const storage = getStorage();
  if (!storage || !expectedId || !updates || typeof updates !== "object") return null;

  try {
    const current = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
    if (current?.id !== expectedId || current.version !== STORAGE_VERSION) return null;
    const updated = { ...current, ...updates, id: current.id, productId: current.productId };
    storage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return null;
  }
};

export const preservePendingProductRedirect = (from, registeredEmail = "") => {
  const storage = getStorage();
  const pendingAction = getPendingProductAction();
  if (
    !storage ||
    !pendingAction ||
    from?.pathname !== "/customer-dashboard" ||
    !new URLSearchParams(from.search || "").has("resumeLandingProduct")
  ) return false;

  try {
    storage.setItem(REDIRECT_STORAGE_KEY, JSON.stringify({
      actionId: pendingAction.id,
      from,
      registeredEmail: String(registeredEmail || "").trim().toLowerCase(),
      expiresAt: pendingAction.expiresAt,
    }));
    return true;
  } catch {
    return false;
  }
};

export const consumePendingProductRedirectForVerification = () => {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const redirect = JSON.parse(storage.getItem(REDIRECT_STORAGE_KEY) || "null");
    storage.removeItem(REDIRECT_STORAGE_KEY);
    const pendingAction = getPendingProductAction();
    if (
      !redirect ||
      redirect.actionId !== pendingAction?.id ||
      !Number.isFinite(Number(redirect.expiresAt)) ||
      Number(redirect.expiresAt) <= Date.now()
    ) return null;
    return {
      from: redirect.from,
      registeredEmail: String(redirect.registeredEmail || "").trim().toLowerCase(),
    };
  } catch {
    try {
      storage.removeItem(REDIRECT_STORAGE_KEY);
    } catch {
      // Ignore unavailable storage cleanup.
    }
    return null;
  }
};

export const consumePendingProductRedirect = () => (
  consumePendingProductRedirectForVerification()?.from || null
);

const getSessionStorage = () => {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

const getWorkflowStorageKey = (actionId, customerId) => (
  `acgc-product-workflow:${encodeURIComponent(customerId)}:${encodeURIComponent(actionId)}`
);

export const savePendingProductWorkflowState = (actionId, customerId, state) => {
  const storage = getSessionStorage();
  const pendingAction = getPendingProductAction();
  if (!storage || !customerId || pendingAction?.id !== actionId) return false;

  try {
    storage.setItem(getWorkflowStorageKey(actionId, customerId), JSON.stringify({
      actionId,
      expiresAt: pendingAction.expiresAt,
      state,
    }));
    return true;
  } catch {
    return false;
  }
};

export const getPendingProductWorkflowState = (actionId, customerId) => {
  const storage = getSessionStorage();
  if (!storage || !customerId) return null;

  try {
    const key = getWorkflowStorageKey(actionId, customerId);
    const saved = JSON.parse(storage.getItem(key) || "null");
    if (
      !saved ||
      saved.actionId !== actionId ||
      !Number.isFinite(Number(saved.expiresAt)) ||
      Number(saved.expiresAt) <= Date.now()
    ) {
      storage.removeItem(key);
      return null;
    }
    return saved.state || null;
  } catch {
    return null;
  }
};

export const clearPendingProductWorkflowState = (actionId, customerId) => {
  const storage = getSessionStorage();
  if (!storage || !customerId || !actionId) return;
  try {
    storage.removeItem(getWorkflowStorageKey(actionId, customerId));
  } catch {
    // Ignore unavailable storage cleanup.
  }
};
