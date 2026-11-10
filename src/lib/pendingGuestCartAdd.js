const STORAGE_KEY = "acgc-pending-guest-cart-add";
const STORAGE_VERSION = 1;
const MAX_AGE_MS = 60 * 60 * 1000;

const getStorage = () => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

export const savePendingGuestCartAddForVerification = (pendingCartAdd, email) => {
  const storage = getStorage();
  const registeredEmail = normalizeEmail(email);
  if (!storage || !pendingCartAdd?.actionId || !pendingCartAdd?.productId || !registeredEmail) return false;

  const createdAt = Date.now();
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      ...pendingCartAdd,
      registeredEmail,
      version: STORAGE_VERSION,
      createdAt,
      expiresAt: createdAt + MAX_AGE_MS,
    }));
    return true;
  } catch {
    return false;
  }
};

export const consumePendingGuestCartAddForVerification = () => {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
    storage.removeItem(STORAGE_KEY);
    if (
      !value ||
      value.version !== STORAGE_VERSION ||
      !value.actionId ||
      !value.productId ||
      !value.product ||
      !normalizeEmail(value.registeredEmail) ||
      !Number.isFinite(Number(value.expiresAt)) ||
      Number(value.expiresAt) <= Date.now()
    ) return null;

    return {
      actionId: value.actionId,
      productId: value.productId,
      product: value.product,
      options: value.options || null,
      registeredEmail: normalizeEmail(value.registeredEmail),
    };
  } catch {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore unavailable storage cleanup.
    }
    return null;
  }
};
