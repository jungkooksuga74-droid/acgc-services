import CustomerDropdown from "@/components/CustomerDropdown";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleCheck,
  Clock3,
  CloudUpload,
  Database,
  Download,
  Eye,
  EyeOff,
  FileArchive,
  History,
  Loader2,
  Pencil,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { RadioGroup } from "radix-ui";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import toast from "react-hot-toast";
import AppToaster from "@/components/AppToaster";

import Sidebar from "../../components/layout/Sidebar";
import Navbar from "../../components/layout/Navbar";
import AdminPageHeader from "../../components/layout/AdminPageHeader";
import OtpCodeInput from "../../components/OtpCodeInput";
import { useAuth } from "../../contexts/AuthContext";
import { useAdminTheme } from "../../contexts/AdminThemeContext";
import { recordActivity } from "@/lib/activityLog";
import { cn } from "@/lib/utils";
import {
  createSystemBackup,
  demoteSuperAdminToStaff,
  deleteSystemBackup,
  downloadSystemBackup,
  getAdminUsers,
  getBackupRecoveryPassword,
  getSystemSettings,
  requestBackupRecoveryPasswordReset,
  resetBackupRecoveryPassword,
  verifyBackupRecoveryPasswordResetCode,
  restoreSystemBackup,
  setBackupRecoveryPassword,
  uploadSystemBackup,
  unrestrictCustomerOnlineOrdering,
  updateAdminUserAccess,
  promoteStaffToSuperAdmin,
  updateSystemSettings,
} from "@/api/users";
import { subscribeToRealtime } from "@/lib/realtimeEvents";
import { normalizeGlobalCustomerPermissions } from "@/lib/customerPermissions";
import { isPasswordPolicySatisfied, PASSWORD_POLICY_MESSAGE } from "@/lib/passwordStrength";
import { STAFF_MODULES, createDefaultStaffAccess as defaultStaffAccess, normalizeStaffAccess } from "../../../shared/staffPermissions.js";

const PERMISSIONS = [
  { key: "can_request_orders", label: "Can Request Orders", description: "Submit new glass/aluminum orders" },
  { key: "can_estimate_pricing", label: "Can Estimate Pricing", description: "Access the pricing estimator tool" },
  { key: "view_only_access", label: "View Only Access", description: "Read-only access to the account" },
  { key: "can_track_products", label: "Can Track Products", description: "Look up order status using a tracking code" },
  { key: "can_upload_feedback", label: "Can Upload/View Feedback", description: "Allow customers to view product feedback" },
  { key: "show_ratings_homepage", label: "Show Ratings on Homepage", description: "Display customer ratings on the homepage" },
];

const SETTINGS_LIST_PAGE_SIZE = 10;

const defaultPermissions = () => Object.fromEntries(PERMISSIONS.map(({ key }) => [key, key !== "view_only_access"]));

const normalizePermissions = (permissions) => {
  const normalized = { ...defaultPermissions(), ...(permissions || {}) };
  if (normalized.view_only_access) {
    PERMISSIONS.forEach(({ key }) => {
      normalized[key] = key === "view_only_access";
    });
  }
  return normalized;
};

const hasAssignedCustomSubrole = (staffAccess = {}) => {
  const assignedSubrole = String(staffAccess.subrole || "").trim().toLowerCase();
  return Boolean(assignedSubrole && Array.isArray(staffAccess.custom_subroles) && staffAccess.custom_subroles.some((subrole) => (
    typeof subrole === "string" && subrole.trim().toLowerCase() === assignedSubrole
  )));
};

const getStaffListDesignation = (staffAccess) => {
  const staffType = staffAccess.staff_type === "helper"
    ? "Helper"
    : staffAccess.staff_type === "skilled_worker"
      ? "Skilled Worker"
      : "Type not assigned";
  const assignedSubrole = String(staffAccess.subrole || "").trim();
  const isCustomSubrole = hasAssignedCustomSubrole(staffAccess);
  return isCustomSubrole ? assignedSubrole : staffType;
};

function Settings() {
  const { user, logout } = useAuth();
  const { darkMode } = useAdminTheme();
  const prefersReducedMotion = useReducedMotion();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const canManageAccess = isAdmin || (user?.role === "skilled_worker" && user.staff_access?.modules?.settings?.enabled === true && user.staff_access.modules.settings.actions?.manage_access === true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("sidebarOpen");
    return stored !== null ? JSON.parse(stored) : true;
  });
  const [users, setUsers] = useState([]);
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [permissionAccount, setPermissionAccount] = useState(null);
  const [permissionDraft, setPermissionDraft] = useState(null);
  const [staffAccount, setStaffAccount] = useState(null);
  const [staffDraft, setStaffDraft] = useState(null);
  const [expandedStaffModule, setExpandedStaffModule] = useState(null);
  const [customSubroleInput, setCustomSubroleInput] = useState("");
  const [editingCustomSubrole, setEditingCustomSubrole] = useState("");
  const [showStaffSubroleMenu, setShowStaffSubroleMenu] = useState(false);
  const [showStaffTypeConfirm, setShowStaffTypeConfirm] = useState(false);
  const [showUpgradeConfirm, setShowUpgradeConfirm] = useState(false);
  const [showConvertStaffConfirm, setShowConvertStaffConfirm] = useState(false);
  const [superAdminPromotionTarget, setSuperAdminPromotionTarget] = useState(null);
  const [superAdminPromotionPassword, setSuperAdminPromotionPassword] = useState("");
  const [showSuperAdminPromotionPassword, setShowSuperAdminPromotionPassword] = useState(false);
  const [superAdminDemotionTarget, setSuperAdminDemotionTarget] = useState(null);
  const [superAdminDemotionPassword, setSuperAdminDemotionPassword] = useState("");
  const [showSuperAdminDemotionPassword, setShowSuperAdminDemotionPassword] = useState(false);
  const [upgradeStaffType, setUpgradeStaffType] = useState("");
  const [restrictionConfirmation, setRestrictionConfirmation] = useState(null);
  const [globalPermissions, setGlobalPermissions] = useState(normalizeGlobalCustomerPermissions);
  const [globalOpen, setGlobalOpen] = useState(false);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [savingMaintenance, setSavingMaintenance] = useState(false);
  const [loadingBackupSettings, setLoadingBackupSettings] = useState(true);
  const [backupRecoveryConfigured, setBackupRecoveryConfigured] = useState(false);
  const [recoveryPasswordResetMode, setRecoveryPasswordResetMode] = useState(false);
  const [recoveryPasswordResetCode, setRecoveryPasswordResetCode] = useState("");
  const [recoveryPasswordResetCodeVerified, setRecoveryPasswordResetCodeVerified] = useState(false);
  const [verifyingRecoveryPasswordResetCode, setVerifyingRecoveryPasswordResetCode] = useState(false);
  const [recoveryPasswordResetCodeError, setRecoveryPasswordResetCodeError] = useState("");
  const [requestingRecoveryPasswordCode, setRequestingRecoveryPasswordCode] = useState(false);
  const [showScheduleTimeModal, setShowScheduleTimeModal] = useState(false);
  const [scheduleTimeDraft, setScheduleTimeDraft] = useState("00:00");

  useEffect(() => {
    if (!recoveryPasswordResetMode || !/^\d{6}$/.test(recoveryPasswordResetCode)) {
      setRecoveryPasswordResetCodeVerified(false);
      setVerifyingRecoveryPasswordResetCode(false);
      setRecoveryPasswordResetCodeError("");
      return undefined;
    }

    let active = true;
    setRecoveryPasswordResetCodeVerified(false);
    setVerifyingRecoveryPasswordResetCode(true);
    setRecoveryPasswordResetCodeError("");
    verifyBackupRecoveryPasswordResetCode(recoveryPasswordResetCode)
      .then(() => {
        if (active) setRecoveryPasswordResetCodeVerified(true);
      })
      .catch((error) => {
        if (active) setRecoveryPasswordResetCodeError(error?.data?.message || error?.message || "The verification code is incorrect.");
      })
      .finally(() => {
        if (active) setVerifyingRecoveryPasswordResetCode(false);
      });

    return () => { active = false; };
  }, [recoveryPasswordResetMode, recoveryPasswordResetCode]);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [newRecoveryPassword, setNewRecoveryPassword] = useState("");
  const [confirmRecoveryPassword, setConfirmRecoveryPassword] = useState("");
  const [showCurrentRecoveryPassword, setShowCurrentRecoveryPassword] = useState(false);
  const [showRecoveryPassword, setShowRecoveryPassword] = useState(false);
  const [showRecoveryPasswordConfirmation, setShowRecoveryPasswordConfirmation] = useState(false);
  const [savingRecoveryPassword, setSavingRecoveryPassword] = useState(false);
  const [restoreRecoveryPassword, setRestoreRecoveryPassword] = useState("");
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [backupImportFile, setBackupImportFile] = useState(null);
  const [backupFilePickerOpen, setBackupFilePickerOpen] = useState(false);
  const [isDraggingBackupFile, setIsDraggingBackupFile] = useState(false);
  const [uploadedBackup, setUploadedBackup] = useState(null);
  const [uploadingBackupFile, setUploadingBackupFile] = useState(false);
  const [removingBackupFile, setRemovingBackupFile] = useState(false);
  const [downloadingBackupId, setDownloadingBackupId] = useState(null);
  const [restoreConfirmation, setRestoreConfirmation] = useState(null);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState(null);
  const [deletingBackup, setDeletingBackup] = useState(false);
  const restoreDialogRef = useRef(null);
  const restoreDialogTriggerRef = useRef(null);
  const backupUploadInputRef = useRef(null);
  const backupFilePickerTriggerRef = useRef(null);
  const deleteDialogRef = useRef(null);
  const deleteDialogTriggerRef = useRef(null);
  const [activeSettingsTab, setActiveSettingsTab] = useState("user-management");
  const [userManagementPage, setUserManagementPage] = useState(1);
  const [orderingRestrictionPage, setOrderingRestrictionPage] = useState(1);
  const [restrictionSearch, setRestrictionSearch] = useState("");

  useEffect(() => {
    setUserManagementPage(1);
  }, [activeTab, search]);

  useEffect(() => {
    setOrderingRestrictionPage(1);
  }, [restrictionSearch]);

  useEffect(() => {
    if (!backupFilePickerOpen) return undefined;

    let returnFocusTimer;
    const handlePickerReturn = () => {
      if (document.visibilityState === "hidden") return;
      window.clearTimeout(returnFocusTimer);
      returnFocusTimer = window.setTimeout(() => {
        setBackupFilePickerOpen(false);
        setIsDraggingBackupFile(false);
        const input = backupUploadInputRef.current;
        if (input && !input.files?.length) input.value = "";
        backupFilePickerTriggerRef.current?.focus({ preventScroll: true });
      }, 150);
    };

    window.addEventListener("focus", handlePickerReturn);
    document.addEventListener("visibilitychange", handlePickerReturn);
    return () => {
      window.clearTimeout(returnFocusTimer);
      window.removeEventListener("focus", handlePickerReturn);
      document.removeEventListener("visibilitychange", handlePickerReturn);
    };
  }, [backupFilePickerOpen]);
  const backupOptions = [
    { id: "daily", label: "Daily", description: "Every day at midnight" },
    { id: "weekly", label: "Weekly", description: "Every Sunday at midnight" },
    { id: "monthly", label: "Monthly", description: "1st of every month" },
  ];

  const getDefaultBackupState = () => {
    return {
      selectedSchedule: "weekly",
      scheduleTime: "00:00",
      lastBackupAt: null,
      nextBackupAt: null,
      status: null,
      backups: [],
    };
  };

  const [backupState, setBackupState] = useState(getDefaultBackupState);
  const backupPageSize = 5;
  const [backupPage, setBackupPage] = useState(1);
  const settingsTabs = [
    { key: "user-management", label: "User Management" },
    ...(isAdmin ? [{ key: "ordering-restriction", label: "Ordering Restriction" }] : []),
    { key: "backup-recovery", label: "Backup & Recovery" },
  ];
  const isOwnStaffAccount = Boolean(
    staffAccount &&
    String(staffAccount._id || staffAccount.id || "") === String(user?._id || user?.id || "")
  );

  useEffect(() => {
    localStorage.setItem("sidebarOpen", JSON.stringify(isSidebarOpen));
  }, [isSidebarOpen]);

  useEffect(() => {
    let active = true;
    const loadSystemSettings = async () => {
      try {
        const response = await getSystemSettings();
        if (!active) return;
        setMaintenanceMode(response.maintenance_mode === true);
        if (response.global_permissions) {
          setGlobalPermissions(normalizeGlobalCustomerPermissions(response.global_permissions));
        }
        setBackupState({
          selectedSchedule: ["daily", "weekly", "monthly"].includes(response.backup_schedule) ? response.backup_schedule : "weekly",
          scheduleTime: response.backup_schedule_time || "00:00",
          status: response.backup_status || null,
          lastBackupAt: response.last_backup_at || null,
          nextBackupAt: response.next_backup_at || null,
          backups: Array.isArray(response.backup_history) ? response.backup_history : [],
        });
        setBackupRecoveryConfigured(response.backup_recovery_password_configured === true);
      } catch (error) {
        if (active) toast.error(error?.data?.message || error?.message || "Unable to load system settings.");
      } finally {
        if (active) setLoadingBackupSettings(false);
      }
    };
    loadSystemSettings();
    const unsubscribeRealtime = subscribeToRealtime("settings", loadSystemSettings);
    return () => {
      active = false;
      unsubscribeRealtime();
    };
  }, []);

  useEffect(() => {
    if (!restoreConfirmation) {
      restoreDialogTriggerRef.current?.focus();
      return undefined;
    }

    if (!restoringBackup) restoreDialogRef.current?.focus();
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !restoringBackup) {
        setRestoreRecoveryPassword("");
        setRestoreConfirmation(null);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [restoreConfirmation, restoringBackup]);

  useEffect(() => {
    if (!deleteConfirmation) {
      deleteDialogTriggerRef.current?.focus();
      return undefined;
    }

    if (!deletingBackup) deleteDialogRef.current?.focus();
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !deletingBackup) setDeleteConfirmation(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [deleteConfirmation, deletingBackup]);

  useEffect(() => {
    const loadUsers = async () => {
      setLoading(true);
      try {
        const response = await getAdminUsers();
        setUsers((response.users || []).map((account) => ({ ...account, is_active: account.is_active !== false })));
      } catch (error) {
        setUsers([]);
        toast.error(error?.data?.message || error?.message || "Unable to load users.");
      } finally {
        setLoading(false);
      }
    };

    loadUsers();
  }, []);

  useEffect(() => {
    const canReveal = user?.role === "admin" || user?.role === "super_admin";
    if (!backupRecoveryConfigured || !canReveal) return undefined;
    let active = true;
    const loadDisplayPassword = async () => {
      try {
        const response = await getBackupRecoveryPassword();
        if (active && response?.backup_recovery_password) setRecoveryPassword(response.backup_recovery_password);
      } catch {
        // Passwords set before display support stay hidden until changed once.
      }
    };
    loadDisplayPassword();
    return () => {
      active = false;
    };
  }, [backupRecoveryConfigured, user?.role]);

  const allDisplayUsers = useMemo(() => {
    const authAdmin = user && (user.role === "admin" || user.role === "super_admin")
      ? {
          ...user,
          _id: user._id || user.id,
          id: user.id || user._id,
          first_name: user.first_name || "Admin",
          last_name: user.last_name || "",
          email: user.email || "",
          role: user.role || "admin",
          is_active: true,
          access_permissions: normalizePermissions(user.access_permissions || defaultPermissions()),
        }
      : null;
    if (!authAdmin) return users;
    const seenIds = new Set([authAdmin._id, authAdmin.id].filter(Boolean));
    const realUsers = users.filter((account) => {
      const accountId = account._id || account.id;
      return accountId && !seenIds.has(accountId);
    });
    const isPrimaryAccount = (account) => account.is_primary_super_admin === true
      || account.is_admin_account === true
      || (account === authAdmin && account.role === "admin");

    return [authAdmin, ...realUsers]
      .map((account, index) => ({ account, index }))
      .sort((left, right) => {
        const getPriority = (account) => isPrimaryAccount(account)
          ? 0
          : account.role === "super_admin" ? 1 : account.role === "skilled_worker" ? 2 : 3;
        return getPriority(left.account) - getPriority(right.account) || left.index - right.index;
      })
      .map(({ account }) => account);
  }, [users, user]);

  const activeSuperAdminCount = useMemo(() => {
    const identities = new Set();
    allDisplayUsers.forEach((account) => {
      if (!["admin", "super_admin"].includes(account.role) || account.is_active === false) return;
      const identity = String(account.email || account._id || account.id || "").trim().toLowerCase();
      if (identity) identities.add(identity);
    });
    return identities.size;
  }, [allDisplayUsers]);

  const restrictedCustomers = useMemo(() => {
    const now = Date.now();
    return users.filter((account) => (
      account.role === "customer"
      && account.online_order_cooldown_until
      && new Date(account.online_order_cooldown_until).getTime() > now
    ));
  }, [users]);

  const filteredRestrictedCustomers = useMemo(() => {
    const query = restrictionSearch.trim().toLowerCase();
    if (!query) return restrictedCustomers;
    return restrictedCustomers.filter((account) => (
      [account.first_name, account.last_name, account.email, account.username, account.phone]
        .some((value) => String(value || "").toLowerCase().includes(query))
    ));
  }, [restrictedCustomers, restrictionSearch]);

  const counts = useMemo(() => ({
    all: allDisplayUsers.length,
    customer: allDisplayUsers.filter((account) => account.role === "customer").length,
    super_admin: allDisplayUsers.filter((account) => account.role === "admin" || account.role === "super_admin").length,
    staff: allDisplayUsers.filter((account) => account.role === "skilled_worker").length,
    helper: allDisplayUsers.filter((account) => account.role === "skilled_worker" && account.staff_access?.staff_type === "helper" && !hasAssignedCustomSubrole(account.staff_access)).length,
    skilled_worker: allDisplayUsers.filter((account) => account.role === "skilled_worker" && account.staff_access?.staff_type === "skilled_worker" && !hasAssignedCustomSubrole(account.staff_access)).length,
    active: allDisplayUsers.filter((account) => account.is_active !== false).length,
  }), [allDisplayUsers]);

  const customSubroleNames = useMemo(() => {
    const reservedNames = new Set(["all users", "customers", "staff", "helper", "skilled worker", "super admin"]);
    return [...new Set(allDisplayUsers
      .filter((account) => account.role === "skilled_worker")
      .flatMap((account) => Array.isArray(account.staff_access?.custom_subroles) ? account.staff_access.custom_subroles : [])
      .filter((subrole) => typeof subrole === "string" && subrole.trim())
      .map((subrole) => subrole.trim())
      .filter((subrole) => !reservedNames.has(subrole.toLowerCase())))]
      .sort((left, right) => left.localeCompare(right));
  }, [allDisplayUsers]);

  const userCategoryTabs = [
    { key: "all", label: "All Users", count: counts.all },
    { key: "customer", label: "Customers", count: counts.customer },
    { key: "super_admin", label: "Super Admin", count: counts.super_admin },
    { key: "helper", label: "Helper", count: counts.helper },
    { key: "skilled_worker", label: "Skilled Worker", count: counts.skilled_worker },
    ...customSubroleNames.map((subrole) => ({
      key: `subrole:${encodeURIComponent(subrole)}`,
      label: subrole,
      count: allDisplayUsers.filter((account) => account.role === "skilled_worker" && hasAssignedCustomSubrole(account.staff_access) && account.staff_access?.subrole?.trim().toLowerCase() === subrole.toLowerCase()).length,
    })),
  ];

  const displayUsers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return allDisplayUsers.filter((account) => {
      const selectedSubrole = activeTab.startsWith("subrole:") ? decodeURIComponent(activeTab.slice("subrole:".length)).toLowerCase() : null;
      const matchesRole = activeTab === "all"
        || activeTab === "super_admin" && (account.role === "admin" || account.role === "super_admin")
        || activeTab === "staff" && account.role === "skilled_worker"
        || (activeTab === "skilled_worker" || activeTab === "helper") && account.role === "skilled_worker" && account.staff_access?.staff_type === activeTab && !hasAssignedCustomSubrole(account.staff_access)
        || selectedSubrole !== null && account.role === "skilled_worker" && hasAssignedCustomSubrole(account.staff_access) && account.staff_access?.subrole?.trim().toLowerCase() === selectedSubrole
        || !["staff", "skilled_worker", "helper"].includes(activeTab) && account.role === activeTab;
      const matchesSearch = !normalizedSearch || [account.first_name, account.last_name, account.email, account.username]
        .some((value) => String(value || "").toLowerCase().includes(normalizedSearch));
      return matchesRole && matchesSearch;
    });
  }, [allDisplayUsers, activeTab, search]);

  const userManagementPageCount = Math.max(1, Math.ceil(displayUsers.length / SETTINGS_LIST_PAGE_SIZE));
  const currentUserManagementPage = Math.min(userManagementPage, userManagementPageCount);
  const paginatedUsers = displayUsers.slice(
    (currentUserManagementPage - 1) * SETTINGS_LIST_PAGE_SIZE,
    currentUserManagementPage * SETTINGS_LIST_PAGE_SIZE,
  );
  const orderingRestrictionPageCount = Math.max(1, Math.ceil(filteredRestrictedCustomers.length / SETTINGS_LIST_PAGE_SIZE));
  const currentOrderingRestrictionPage = Math.min(orderingRestrictionPage, orderingRestrictionPageCount);
  const paginatedRestrictedCustomers = filteredRestrictedCustomers.slice(
    (currentOrderingRestrictionPage - 1) * SETTINGS_LIST_PAGE_SIZE,
    currentOrderingRestrictionPage * SETTINGS_LIST_PAGE_SIZE,
  );

  const renderListPagination = (total, page, pageCount, setPage) => {
    if (total <= SETTINGS_LIST_PAGE_SIZE) return null;
    const firstItem = (page - 1) * SETTINGS_LIST_PAGE_SIZE + 1;
    const lastItem = Math.min(page * SETTINGS_LIST_PAGE_SIZE, total);
    return (
      <div className={`mt-4 flex flex-col items-center justify-between gap-3 border-t pt-4 sm:flex-row ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
        <p className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Showing {firstItem}–{lastItem} of {total}</p>
        <nav aria-label="User list pagination" className="flex flex-wrap items-center justify-center gap-1.5">
          <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} aria-label="Previous page" className={`inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${darkMode ? "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
            <ChevronLeft size={14} /> Previous
          </button>
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
            <button key={pageNumber} type="button" onClick={() => setPage(pageNumber)} aria-current={page === pageNumber ? "page" : undefined} aria-label={`Page ${pageNumber}`} className={`h-9 min-w-9 rounded-lg border px-2.5 text-xs font-semibold ${page === pageNumber ? "border-red-600 bg-red-600 text-white" : darkMode ? "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
              {pageNumber}
            </button>
          ))}
          <button type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount} aria-label="Next page" className={`inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${darkMode ? "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
            Next <ChevronRight size={14} />
          </button>
        </nav>
      </div>
    );
  };

  const getPermissions = (account) => normalizePermissions(account.access_permissions);

  const updateGlobalPermission = (key, checked) => {
    setGlobalPermissions((current) => {
      const next = {
        ...current,
        ...(key !== "view_only_access" && checked ? { view_only_access: false } : {}),
        [key]: checked,
      };
      return normalizeGlobalCustomerPermissions(next);
    });
  };

  const updateUser = async (account, patch) => {
    const accountId = account._id || account.id;
    const previous = account;
    const nextPermissions = normalizePermissions({ ...getPermissions(account), ...patch });
    const next = { ...account, access_permissions: nextPermissions };
    setUsers((current) => current.map((item) => (item._id || item.id) === accountId ? next : item));
    setSavingId(accountId);
    try {
      const response = await updateAdminUserAccess(accountId, nextPermissions);
      setUsers((current) => current.map((item) => (item._id || item.id) === accountId ? response.user : item));
      recordActivity(user, `Updated access permissions for ${account.first_name} ${account.last_name}.`, "Settings");
      return true;
    } catch (error) {
      setUsers((current) => current.map((item) => (item._id || item.id) === accountId ? previous : item));
      toast.error(error?.data?.message || error?.message || "Unable to update permissions.");
      return false;
    } finally {
      setSavingId(null);
    }
  };

  const handleUnrestrictCustomer = async (account) => {
    if (!account) return;
    const accountId = account._id || account.id;
    const customerName = `${account.first_name || "Customer"} ${account.last_name || ""}`.trim();
    setSavingId(accountId);
    try {
      const response = await unrestrictCustomerOnlineOrdering(accountId);
      setUsers((current) => current.map((item) => (
        (item._id || item.id) === accountId ? response.user : item
      )));
      setRestrictionConfirmation(null);
      recordActivity(user, `Removed the online ordering restriction for ${customerName}.`, "Settings");
      toast.success(`Online ordering restriction removed for ${customerName}.`);
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to remove the online ordering restriction.");
    } finally {
      setSavingId(null);
    }
  };

  const renderBackupRecovery = (metrics) => {
    const isSuccessfulStatus = metrics.status === "Success";
    const isFailedStatus = metrics.status === "Failed" || metrics.status === "Error";
    const statusTone = isSuccessfulStatus
      ? "bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-300"
      : isFailedStatus
        ? "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300"
        : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300";
    const statusValueTone = isSuccessfulStatus
      ? "text-green-700 dark:text-green-300"
      : isFailedStatus
        ? "text-red-700 dark:text-red-300"
        : "text-amber-800 dark:text-amber-300";
    const hasSelectedBackupFile = Boolean(backupImportFile || uploadedBackup);

    return (
      <>
        {activeSettingsTab === "backup-recovery" && (
          <div className="mt-4.5 min-w-0 max-w-full space-y-4.5 overflow-x-clip">
            <div className="grid grid-cols-1 gap-2 pr-2 sm:gap-3.5 sm:pr-0 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
              <motion.article whileHover={prefersReducedMotion ? undefined : { y: -2 }} transition={{ duration: prefersReducedMotion ? 0 : 0.18 }} className={cn("flex min-w-0 items-center gap-2.5 rounded-2xl border px-3 py-2.5 transition-colors motion-reduce:transition-none hover:border-brand/30 sm:gap-3.5 sm:px-4.5 sm:py-4", "border-border bg-card dark:border-slate-700 dark:bg-slate-900")}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand dark:bg-brand/15 dark:text-brand-dark-text sm:size-11"><Calendar aria-hidden="true" className="size-[18px] sm:size-[21px]" /></span>
                <span className="min-w-0"><span className="block text-[9px] font-medium uppercase tracking-[0.1em] text-muted-foreground sm:text-[11px]">Last backup</span><span className="mt-0.5 block text-base font-medium text-foreground sm:mt-1 sm:text-[19px]">{metrics.lastBackupAt ? formatBackupDateShort(metrics.lastBackupAt) : "No backup"}</span></span>
              </motion.article>
              <motion.article whileHover={prefersReducedMotion ? undefined : { y: -2 }} transition={{ duration: prefersReducedMotion ? 0 : 0.18 }} className={cn("flex min-w-0 items-center gap-2.5 rounded-2xl border px-3 py-2.5 transition-colors motion-reduce:transition-none hover:border-brand/30 sm:gap-3.5 sm:px-4.5 sm:py-4", "border-border bg-card dark:border-slate-700 dark:bg-slate-900")}>
                <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl sm:size-11", statusTone)}><History aria-hidden="true" className="size-[18px] sm:size-[21px]" /></span>
                <span className="min-w-0"><span className="block text-[9px] font-medium uppercase tracking-[0.1em] text-muted-foreground sm:text-[11px]">Backup status</span><span className={cn("mt-0.5 inline-flex items-center gap-2 text-base font-medium sm:mt-1 sm:text-[19px]", statusValueTone)}><span className="relative flex size-[9px] shrink-0" aria-hidden="true"><span className={cn("absolute inline-flex size-full rounded-full motion-safe:animate-ping motion-reduce:animate-none", isSuccessfulStatus ? "bg-green-500/45" : isFailedStatus ? "bg-red-500/45" : "bg-amber-500/45")} /><span className={cn("relative inline-flex size-[9px] rounded-full", isSuccessfulStatus ? "bg-green-500" : isFailedStatus ? "bg-red-500" : "bg-amber-500")} /></span>{metrics.status}</span></span>
              </motion.article>
              <motion.article whileHover={prefersReducedMotion ? undefined : { y: -2 }} transition={{ duration: prefersReducedMotion ? 0 : 0.18 }} className={cn("flex min-w-0 items-center gap-2.5 rounded-2xl border px-3 py-2.5 transition-colors motion-reduce:transition-none hover:border-brand/30 sm:gap-3.5 sm:px-4.5 sm:py-4", "border-border bg-card dark:border-slate-700 dark:bg-slate-900")}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 sm:size-11"><Database aria-hidden="true" className="size-[18px] sm:size-[21px]" /></span>
                <span className="min-w-0"><span className="block text-[9px] font-medium uppercase tracking-[0.1em] text-muted-foreground sm:text-[11px]">Backup snapshots</span><span className="mt-0.5 block text-base font-medium text-foreground sm:mt-1 sm:text-[19px]">{metrics.totalBackups} backups</span></span>
              </motion.article>
              <motion.article whileHover={prefersReducedMotion ? undefined : { y: -2 }} transition={{ duration: prefersReducedMotion ? 0 : 0.18 }} className={cn("flex min-w-0 items-center gap-2.5 rounded-2xl border px-3 py-2.5 transition-colors motion-reduce:transition-none hover:border-brand/30 sm:gap-3.5 sm:px-4.5 sm:py-4", "border-border bg-card dark:border-slate-700 dark:bg-slate-900")}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-green-500/10 text-green-700 dark:bg-green-950/60 dark:text-green-300 sm:size-11"><CircleCheck aria-hidden="true" className="size-[18px] sm:size-[21px]" /></span>
                <span className="min-w-0"><span className="block text-[9px] font-medium uppercase tracking-[0.1em] text-muted-foreground sm:text-[11px]">Success rate</span><span className="mt-0.5 block text-base font-medium text-foreground sm:mt-1 sm:text-[19px]">{metrics.successRate}%</span></span>
              </motion.article>
            </div>

            <section className="rounded-2xl border border-border bg-card p-5 dark:border-slate-700 dark:bg-slate-900 max-[520px]:p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[19px] font-medium text-foreground">Recovery Password</h3>
                  <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">Set a private password required to authorize a full restore. The current password stays visible to admins here until it is changed. Recovery reset codes are sent to <span className="font-medium text-foreground">{user?.email || "your administrator email"}</span>.</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {backupRecoveryConfigured && (
                    <button type="button" onClick={recoveryPasswordResetMode ? cancelRecoveryPasswordReset : handleRequestRecoveryPasswordCode} disabled={requestingRecoveryPasswordCode || savingRecoveryPassword} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800">
                      {requestingRecoveryPasswordCode ? "Sending code..." : recoveryPasswordResetMode ? "Cancel reset" : "Forgot password?"}
                    </button>
                  )}
                  <span className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium", backupRecoveryConfigured ? "bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-300" : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300")}>
                    <ShieldCheck aria-hidden="true" className="size-4" />
                    {backupRecoveryConfigured ? "Configured" : "Setup required"}
                  </span>
                </div>
              </div>
              <form onSubmit={handleSaveBackupRecoveryPassword} className="mt-4 grid gap-3 sm:grid-cols-2">
                {recoveryPasswordResetMode ? (
                  <AnimatePresence initial={false}>
                    {!recoveryPasswordResetCodeVerified && (
                      <motion.label
                        key="recovery-verification-code"
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0, transition: { duration: prefersReducedMotion ? 0 : 0.3, ease: "easeOut" } }}
                        exit={{ opacity: 0, y: -5, transition: { duration: prefersReducedMotion ? 0 : 0.45, ease: "easeInOut" } }}
                        className="grid gap-1.5 text-xs font-medium text-muted-foreground"
                      >
                        <span>Email verification code</span>
                        <OtpCodeInput id="recovery-password-reset-code" value={recoveryPasswordResetCode} onChange={setRecoveryPasswordResetCode} darkMode={darkMode} autoFocus />
                        {verifyingRecoveryPasswordResetCode ? (
                          <span className="text-[11px] font-normal" role="status" aria-live="polite">Checking verification code...</span>
                        ) : recoveryPasswordResetCodeError ? (
                          <span className="text-[11px] font-medium text-red-600 dark:text-red-400" role="alert">{recoveryPasswordResetCodeError}</span>
                        ) : (
                          <span className="text-[11px] font-normal">Check your administrator email. The code expires in 10 minutes.</span>
                        )}
                      </motion.label>
                    )}
                  </AnimatePresence>
                ) : (
                  <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                    <span>Current password</span>
                    <span className="relative block">
                      <input type={showCurrentRecoveryPassword ? "text" : "password"} autoComplete="new-password" data-1p-ignore="true" data-lpignore="true" data-form-type="other" value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} placeholder={backupRecoveryConfigured ? "Enter current password" : "Not set yet"} disabled={!backupRecoveryConfigured || savingRecoveryPassword} required={backupRecoveryConfigured} minLength={12} maxLength={128} className="h-10 w-full rounded-md border border-border bg-background px-3 pr-10 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-950" />
                      <button type="button" onClick={() => setShowCurrentRecoveryPassword((visible) => !visible)} disabled={!backupRecoveryConfigured || savingRecoveryPassword} aria-label={showCurrentRecoveryPassword ? "Hide current recovery password" : "Show current recovery password"} aria-pressed={showCurrentRecoveryPassword} className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50">
                        {showCurrentRecoveryPassword ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
                      </button>
                    </span>
                  </label>
                )}
                {(!recoveryPasswordResetMode || recoveryPasswordResetCodeVerified) && (
                  <>
                    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                      <span>{backupRecoveryConfigured ? "New password" : "New recovery password"}</span>
                      <span className="relative block">
                        <input type={showRecoveryPassword ? "text" : "password"} autoComplete="new-password" value={newRecoveryPassword} onChange={(event) => setNewRecoveryPassword(event.target.value)} required minLength={12} maxLength={128} aria-describedby="recovery-password-requirements" className="h-10 w-full rounded-md border border-border bg-background px-3 pr-10 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-slate-700 dark:bg-slate-950" />
                        <button type="button" onClick={() => setShowRecoveryPassword((visible) => !visible)} aria-label={showRecoveryPassword ? "Hide new recovery password" : "Show new recovery password"} aria-pressed={showRecoveryPassword} className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand">
                          {showRecoveryPassword ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
                        </button>
                      </span>
                    </label>
                    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                      <span>Confirm new password</span>
                      <span className="relative block">
                        <input type={showRecoveryPasswordConfirmation ? "text" : "password"} autoComplete="new-password" value={confirmRecoveryPassword} onChange={(event) => setConfirmRecoveryPassword(event.target.value)} required minLength={12} maxLength={128} aria-invalid={recoveryPasswordConfirmationMismatch} aria-describedby="recovery-password-requirements" className={cn("h-10 w-full rounded-md border bg-background px-3 pr-10 text-sm text-foreground outline-none focus-visible:ring-2 dark:bg-slate-950", recoveryPasswordConfirmationMismatch ? "border-red-500 focus-visible:ring-red-500" : recoveryPasswordsMatch ? "border-emerald-500 focus-visible:ring-emerald-500" : "border-border focus-visible:ring-brand", "dark:border-slate-700")} />
                        <button type="button" onClick={() => setShowRecoveryPasswordConfirmation((visible) => !visible)} aria-label={showRecoveryPasswordConfirmation ? "Hide password confirmation" : "Show password confirmation"} aria-pressed={showRecoveryPasswordConfirmation} className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand">
                          {showRecoveryPasswordConfirmation ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
                        </button>
                      </span>
                      {confirmRecoveryPassword.length > 0 && <span role="status" aria-live="polite" className={recoveryPasswordsMatch ? "text-xs font-medium text-emerald-700 dark:text-emerald-400" : "text-xs font-medium text-red-600 dark:text-red-400"}>{recoveryPasswordsMatch ? "Passwords match" : "Passwords do not match"}</span>}
                    </label>
                    <div className="flex items-end"><button type="submit" disabled={savingRecoveryPassword || requestingRecoveryPasswordCode || loadingBackupSettings || (recoveryPasswordResetMode && !recoveryPasswordResetCodeVerified) || recoveryPasswordConfirmationMismatch || !recoveryPasswordsMatch || !recoveryPasswordChecks.every(({ met }) => met)} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-dark-fill">{savingRecoveryPassword && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}{savingRecoveryPassword ? "Saving..." : recoveryPasswordResetMode ? "Reset Password" : backupRecoveryConfigured ? "Change Password" : "Set Password"}</button></div>
                  </>
                )}
              </form>
              {(!recoveryPasswordResetMode || recoveryPasswordResetCodeVerified) && <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-950/60">
                <p className="mb-2 text-xs font-medium leading-relaxed text-slate-700 dark:text-slate-200">Use 12+ characters with uppercase, lowercase, a number, and a symbol for a stronger password.</p>
                <ul id="recovery-password-requirements" aria-label="Recovery password requirements" className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  {recoveryPasswordChecks.map(({ label, met }) => {
                    const unmetAfterTyping = newRecoveryPassword.length > 0 && !met;
                    return (
                      <li key={label} className={cn("inline-flex min-w-0 items-center gap-2 text-sm font-medium", met ? "text-emerald-800 dark:text-emerald-300" : unmetAfterTyping ? "text-red-700 dark:text-red-300" : "text-slate-700 dark:text-slate-300")}>
                        {met ? <CircleCheck aria-hidden="true" className="size-4 shrink-0" /> : <Circle aria-hidden="true" className={cn("size-4 shrink-0", unmetAfterTyping ? "text-red-500" : "text-slate-400 dark:text-slate-500")} />}
                        <span>{label}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>}
            </section>
            <p className="text-sm leading-relaxed text-muted-foreground">Full backups include every acgc_db collection, document, and index — database only, no files. Archives are protected with your recovery password and kept for 30 days (the latest backup is always protected). Cloudinary-hosted media stays in Cloudinary; existing database references remain unchanged.</p>

            <div className="grid grid-cols-1 items-stretch gap-4.5 lg:grid-cols-[minmax(300px,390px)_minmax(0,1fr)]">
              <section className="flex min-w-0 flex-col overflow-hidden rounded-[20px] border border-border bg-card dark:border-slate-700 dark:bg-slate-900">
                <header className="px-6 pt-5.5 max-[520px]:px-4"><h3 id="backup-schedule-heading" className="text-[19px] font-medium text-foreground">Backup Schedule</h3></header>
                <div className="flex-1 px-6 pb-5.5 pt-4.5 max-[520px]:px-4">
                  <RadioGroup.Root value={backupState.selectedSchedule} onValueChange={handleScheduleChange} disabled={loadingBackupSettings} aria-label="Backup Schedule" aria-labelledby="backup-schedule-heading" className="flex flex-col gap-2.5">
                    {backupOptions.map((option) => {
                      const isSelected = backupState.selectedSchedule === option.id;
                      const ScheduleIcon = { daily: Calendar, weekly: CalendarDays, monthly: CalendarRange }[option.id];
                      return (
                        <label key={option.id} htmlFor={`backup-schedule-${option.id}`} className={cn(
                          "flex min-h-[74px] cursor-pointer items-center gap-3 rounded-[14px] px-4 py-3.25 transition-colors motion-reduce:transition-none",
                          isSelected ? "border-[1.5px] border-brand/50 bg-brand/[0.07] dark:border-brand-dark-text/50 dark:bg-brand-dark-fill/10" : "border border-border bg-background hover:bg-muted/50 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-800",
                        )}>
                          <span className={cn("flex size-[42px] shrink-0 items-center justify-center rounded-[11px] transition-colors motion-reduce:transition-none", isSelected ? "bg-brand text-white dark:bg-brand-dark-fill" : "bg-muted text-muted-foreground dark:bg-slate-800 dark:text-slate-300")}><ScheduleIcon aria-hidden="true" className="size-5" /></span>
                          <span className="min-w-0 flex-1"><span className="block text-base font-medium text-foreground">{option.label}</span><span className="mt-0.5 block text-sm text-muted-foreground">{option.description}</span></span>
                          <RadioGroup.Item id={`backup-schedule-${option.id}`} value={option.id} aria-label={option.label} className="flex size-5 shrink-0 items-center justify-center rounded-full border border-muted-foreground/50 text-brand outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=checked]:border-brand motion-reduce:transition-none dark:border-slate-500 dark:text-brand-dark-text dark:focus-visible:ring-offset-slate-900 dark:data-[state=checked]:border-brand-dark-text">
                            <RadioGroup.Indicator className="flex items-center justify-center"><span className="size-2.5 rounded-full bg-current" /></RadioGroup.Indicator>
                          </RadioGroup.Item>
                        </label>
                      );
                    })}
                  </RadioGroup.Root>
                  <label className="mt-4 block text-sm font-medium text-foreground">Scheduled backup time</label>
                  <button type="button" disabled={loadingBackupSettings} onClick={() => { setScheduleTimeDraft(backupState.scheduleTime || "00:00"); setShowScheduleTimeModal(true); }} className="mt-1.5 flex h-10 w-full items-center justify-between rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-900">
                    <span>{new Date(`2000-01-01T${backupState.scheduleTime || "00:00"}:00`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                    <Clock3 aria-hidden="true" className="size-4 text-muted-foreground" />
                  </button>
                  <p className="mt-1.5 text-xs text-muted-foreground">Uses Asia/Manila time.</p>
                  <p className="mt-3.5 text-xs leading-relaxed text-muted-foreground">
                    {backupState.nextBackupAt
                      ? `Next ${backupState.selectedSchedule} backup: ${new Date(backupState.nextBackupAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" })} · Asia/Manila`
                      : "Scheduled backups use your selected time, Asia/Manila."}
                  </p>
                </div>
                <footer className="flex min-h-[70px] items-center border-t border-border bg-muted/50 px-6 py-3.5 dark:border-slate-700 dark:bg-slate-800/50 max-[520px]:px-4">
                  <button type="button" onClick={handleBackupNow} disabled={loadingBackupSettings || creatingBackup || !backupRecoveryConfigured} className="inline-flex h-10.5 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:bg-brand-dark-fill">
                    {creatingBackup ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Database aria-hidden="true" className="size-4" />}
                    {creatingBackup ? "Creating full backup..." : "Create Full Backup"}
                  </button>
                </footer>
              </section>

              <section className="flex min-w-0 flex-col overflow-hidden rounded-[20px] border border-border bg-card dark:border-slate-700 dark:bg-slate-900">
                <header className="px-6 pt-5.5 max-[520px]:px-4">
                  <h3 className="text-[19px] font-medium text-foreground">Upload Backup File</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Drop a backup <span className="font-medium text-foreground">ZIP</span> here or choose one to restore your system. Legacy <code className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground">.json.gz</code> backups are also supported.</p>
                </header>
                <div className="flex-1 px-6 pb-5.5 pt-4.5 max-[520px]:px-4">
                  <div
                    onDragEnter={(event) => {
                      event.preventDefault();
                      if (!uploadedBackup && !uploadingBackupFile) setIsDraggingBackupFile(true);
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={(event) => {
                      const nextTarget = event.relatedTarget;
                      if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) setIsDraggingBackupFile(false);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      setIsDraggingBackupFile(false);
                      if (!uploadedBackup && !uploadingBackupFile) handleBackupFileSelection(event.dataTransfer.files?.[0]);
                    }}
                    className={cn("flex h-full min-h-[200px] flex-col items-center justify-center gap-3.5 rounded-2xl border-[1.5px] border-dashed bg-muted/30 p-7 text-center transition-colors motion-reduce:transition-none max-[520px]:p-5", isDraggingBackupFile ? "border-brand bg-brand/[0.07] ring-4 ring-brand/10 dark:border-brand-dark-text dark:bg-brand-dark-fill/10" : "border-border hover:border-brand/60 hover:bg-brand/[0.04] dark:border-slate-600 dark:hover:border-brand-dark-text/60 dark:hover:bg-brand-dark-fill/5")}
                  >
                    <span className={cn("flex size-[58px] shrink-0 items-center justify-center rounded-[18px] border border-border bg-background text-brand transition-transform transition-colors motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-950 dark:text-brand-dark-text", hasSelectedBackupFile || isDraggingBackupFile ? "-translate-y-[3px] border-brand bg-brand text-white dark:border-brand-dark-fill dark:bg-brand-dark-fill dark:text-white" : "")}>
                      {hasSelectedBackupFile ? <FileArchive aria-hidden="true" className="size-[25px]" /> : <CloudUpload aria-hidden="true" className="size-[25px]" />}
                    </span>
                    {hasSelectedBackupFile ? (
                      <div className="min-w-0 max-w-full">
                        <p className="break-all font-mono text-sm font-medium text-foreground">{uploadedBackup ? `Uploaded: ${backupImportFile?.name || uploadedBackup.name}` : backupImportFile?.name || uploadedBackup?.name}</p>
                        <p className="mt-1 text-[13px] text-muted-foreground">{backupImportFile ? formatBackupSize({ sizeBytes: backupImportFile.size }) : formatBackupSize(uploadedBackup)}</p>
                      </div>
                    ) : (
                      <p className="text-[15px] text-muted-foreground">{isDraggingBackupFile ? "Drop backup file to select" : "Drop a backup file here or choose a file"}</p>
                    )}
                    <button
                      ref={backupFilePickerTriggerRef}
                      type="button"
                      data-no-pull-refresh
                      disabled={Boolean(uploadedBackup) || uploadingBackupFile}
                      onClick={() => {
                        setBackupFilePickerOpen(true);
                        backupUploadInputRef.current?.click();
                      }}
                      aria-busy={backupFilePickerOpen}
                      className={cn("inline-flex h-10.5 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-background px-5 text-sm font-medium text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none", "hover:border-brand hover:text-brand dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-brand-dark-text dark:hover:text-brand-dark-text", uploadedBackup || uploadingBackupFile ? "cursor-not-allowed opacity-50" : "")}
                    >
                      <Upload aria-hidden="true" className="size-4" />
                      Choose backup file
                    </button>
                    <input
                      ref={backupUploadInputRef}
                      id="system-backup-upload"
                      type="file"
                      accept=".zip,.json.gz.enc,.json.gz,application/zip,application/octet-stream,application/gzip,application/x-gzip"
                      disabled={Boolean(uploadedBackup) || uploadingBackupFile}
                      onCancel={() => {
                        setBackupFilePickerOpen(false);
                        setIsDraggingBackupFile(false);
                        if (backupUploadInputRef.current) backupUploadInputRef.current.value = "";
                        backupFilePickerTriggerRef.current?.focus({ preventScroll: true });
                      }}
                      onChange={(event) => {
                        setBackupFilePickerOpen(false);
                        handleBackupFileSelection(event.target.files?.[0]);
                        event.target.value = "";
                      }}
                      className="sr-only"
                    />
                  </div>
                </div>
                <footer className="flex min-h-[70px] flex-wrap items-center gap-2.5 border-t border-border bg-muted/50 px-6 py-3.5 dark:border-slate-700 dark:bg-slate-800/50 max-[520px]:grid max-[520px]:grid-cols-2 max-[520px]:px-4">
                  <button type="button" onClick={handleSyncUploadedBackup} disabled={(!uploadedBackup && !backupImportFile) || restoringBackup || uploadingBackupFile} className="inline-flex h-10.5 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 motion-reduce:transition-none dark:bg-brand-dark-fill dark:disabled:bg-slate-700 dark:disabled:text-slate-400 max-[520px]:w-full max-[520px]:px-3">
                    {uploadingBackupFile || restoringBackup ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <RotateCcw aria-hidden="true" className="size-4" />}
                    {uploadingBackupFile ? "Uploading..." : restoringBackup ? "Syncing..." : "Sync"}
                  </button>
                  <button type="button" onClick={handleRemoveBackupFile} disabled={(!backupImportFile && !uploadedBackup) || uploadingBackupFile || removingBackupFile || restoringBackup} className="inline-flex h-10.5 items-center justify-center gap-2 rounded-xl border border-border bg-background px-5 text-sm font-medium text-foreground transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 motion-reduce:transition-none dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-red-800 dark:hover:bg-red-950/40 dark:hover:text-red-300 dark:disabled:border-slate-700 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 max-[520px]:w-full max-[520px]:px-2">
                    {removingBackupFile ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Trash2 aria-hidden="true" className="size-4" />}
                    {removingBackupFile ? "Removing..." : "Remove File"}
                  </button>
                </footer>
              </section>
            </div>

              <section className="space-y-3">
                <h3 className={`text-[17px] font-medium ${darkMode ? "text-slate-100" : "text-foreground"}`}>Backup History</h3>
                <div className={`overflow-hidden rounded-2xl border ${darkMode ? "border-slate-700 bg-[#0b1420]" : "border-border bg-background"}`}>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="backup-history-table min-w-[760px] w-full border-collapse text-left">
                      <thead className="bg-muted/50">
                        <tr className="border-b border-border">
                          <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Backup Name</th>
                          <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Date</th>
                          <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Time</th>
                          <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Type</th>
                          <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Size</th>
                          <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Status</th>
                          <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedBackups.map((backup) => (
                          <tr key={backup.id} className="border-b border-border transition-colors last:border-b-0 hover:bg-muted/50 motion-reduce:transition-none">
                            <td className={`px-4 py-3 ${darkMode ? "text-slate-200" : "text-slate-900"}`}>
                              <span className="block break-all font-mono text-[13px]">{backup.name}</span>
                              <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${["Scheduled", "System"].includes(backup.trigger) ? darkMode ? "border-emerald-800 bg-emerald-950/60 text-emerald-300" : "border-emerald-200 bg-emerald-50 text-emerald-800" : darkMode ? "border-blue-800 bg-blue-950/60 text-blue-300" : "border-blue-200 bg-blue-50 text-blue-800"}`}>
                                {["Scheduled", "System"].includes(backup.trigger) ? "Automatic Backup" : "Manual Backup"}
                              </span>
                              {Number.isFinite(backup.collectionCount) && <span className={`mt-1 block text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{backup.collectionCount} collections · {backup.documentCount || 0} records</span>}
                            </td>
                            <td className={`px-4 py-3 text-sm ${darkMode ? "text-slate-400" : "text-slate-600"}`}>{formatBackupDateShort(backup.date)}</td>
                            <td className={`px-4 py-3 text-sm tabular-nums ${darkMode ? "text-slate-400" : "text-slate-600"}`}>{formatBackupTime(backup.date)}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${backup.type === "Full System" ? darkMode ? "border-red-400/60 bg-red-950/70 text-red-200" : "border-brand/50 bg-brand/[0.08] text-brand" : darkMode ? "border-slate-700 bg-slate-800 text-slate-300" : "border-border bg-muted text-muted-foreground"}`}>{backup.type}</span>
                            </td>
                            <td className={`px-4 py-3 text-right text-sm tabular-nums ${darkMode ? "text-slate-200" : "text-slate-900"}`}>{formatBackupSize(backup)}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${darkMode ? "bg-green-950/50 text-green-300" : "bg-green-500/10 text-green-700"}`}>
                                <span className="size-1.5 rounded-full bg-green-500" />
                                {backup.status}
                              </span>
                              {backup.verified === true && <span className="mt-1 block text-[10px] font-medium text-muted-foreground">SHA-256 verified</span>}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex justify-end gap-2">
                                <button type="button" onClick={() => handleDownloadBackup(backup)} disabled={downloadingBackupId !== null} title="Download encrypted system backup" className={`inline-flex size-9 items-center justify-center rounded-[10px] transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${darkMode ? "bg-blue-950/70 text-blue-300 hover:bg-blue-700 hover:text-white" : "bg-blue-500/10 text-blue-700 hover:bg-blue-600 hover:text-white"}`} aria-label={`Download backup ${backup.name}`}>
                                  {downloadingBackupId === backup.id ? <Loader2 aria-hidden="true" className="size-5 animate-spin" /> : <Download aria-hidden="true" className="size-5" />}
                                </button>
                                <button type="button" onClick={() => handleRestoreBackup(backup.id)} className={`inline-flex size-9 items-center justify-center rounded-[10px] transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none ${darkMode ? "bg-amber-950/70 text-amber-300 hover:bg-amber-700 hover:text-white" : "bg-brand/[0.08] text-brand hover:bg-brand hover:text-white"}`} aria-label="Restore backup">
                                  <RotateCcw aria-hidden="true" className="size-5" />
                                </button>
                                <button type="button" onClick={() => handleDeleteBackup(backup.id)} className={`inline-flex size-9 items-center justify-center rounded-[10px] transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none ${darkMode ? "bg-red-950/70 text-red-300 hover:bg-red-700 hover:text-white" : "bg-red-500/10 text-red-700 hover:bg-red-600 hover:text-white"}`} aria-label="Delete backup">
                                  <Trash2 aria-hidden="true" className="size-5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}

                        {(backupState.backups || []).length === 0 && (
                          <tr>
                            <td colSpan="7" className={`px-4 py-6 text-center text-sm ${darkMode ? "text-slate-400" : "text-muted-foreground"}`}>
                              {loadingBackupSettings ? "Loading backup history..." : "No backup snapshots yet. Create your first backup to get started."}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="space-y-3 p-3 md:hidden">
                    {backupRecords.length > 0 ? paginatedBackups.map((backup) => (
                      <article key={backup.id} className={`rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-900" : "border-border bg-background"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className={`break-all font-mono text-xs font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{backup.name}</p>
                            <p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-600"}`}>{formatBackupDateShort(backup.date)} · {formatBackupTime(backup.date)}</p>
                            <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${["Scheduled", "System"].includes(backup.trigger) ? darkMode ? "border-emerald-800 bg-emerald-950/60 text-emerald-300" : "border-emerald-200 bg-emerald-50 text-emerald-800" : darkMode ? "border-blue-800 bg-blue-950/60 text-blue-300" : "border-blue-200 bg-blue-50 text-blue-800"}`}>
                              {["Scheduled", "System"].includes(backup.trigger) ? "Automatic Backup" : "Manual Backup"}
                            </span>
                            {Number.isFinite(backup.collectionCount) && <p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{backup.collectionCount} collections · {backup.documentCount || 0} records · {backup.trigger || "Manual"}{backup.verified === true ? " · SHA-256 verified" : ""}</p>}
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${darkMode ? "bg-green-950/50 text-green-300" : "bg-green-500/10 text-green-700"}`}>{backup.status}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${backup.type === "Full System" ? darkMode ? "border-red-400/60 bg-red-950/70 text-red-200" : "border-brand/50 bg-brand/[0.08] text-brand" : darkMode ? "border-slate-700 bg-slate-800 text-slate-300" : "border-border bg-muted text-muted-foreground"}`}>{backup.type}</span>
                            <span className={`text-xs tabular-nums ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{formatBackupSize(backup)}</span>
                          </div>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => handleDownloadBackup(backup)} disabled={downloadingBackupId !== null} title="Download encrypted system backup" aria-label={`Download backup ${backup.name}`} className={`inline-flex size-9 items-center justify-center rounded-[10px] disabled:cursor-not-allowed disabled:opacity-50 ${darkMode ? "bg-blue-950/70 text-blue-300 hover:bg-blue-700 hover:text-white" : "bg-blue-500/10 text-blue-700 hover:bg-blue-600 hover:text-white"}`}>
                              {downloadingBackupId === backup.id ? <Loader2 aria-hidden="true" className="size-5 animate-spin" /> : <Download aria-hidden="true" className="size-5" />}
                            </button>
                            <button type="button" onClick={() => handleRestoreBackup(backup.id)} aria-label={`Restore backup ${backup.name}`} className={`inline-flex size-9 items-center justify-center rounded-[10px] ${darkMode ? "bg-amber-950/70 text-amber-300 hover:bg-amber-700 hover:text-white" : "bg-brand/[0.08] text-brand hover:bg-brand hover:text-white"}`}>
                              <RotateCcw aria-hidden="true" className="size-5" />
                            </button>
                            <button type="button" onClick={() => handleDeleteBackup(backup.id)} aria-label={`Delete backup ${backup.name}`} className={`inline-flex size-9 items-center justify-center rounded-[10px] ${darkMode ? "bg-red-950/70 text-red-300 hover:bg-red-700 hover:text-white" : "bg-red-500/10 text-red-700 hover:bg-red-600 hover:text-white"}`}>
                              <Trash2 aria-hidden="true" className="size-5" />
                            </button>
                          </div>
                        </div>
                      </article>
                    )) : (
                      <div className={`p-6 text-center text-sm ${darkMode ? "text-slate-400" : "text-muted-foreground"}`}>
                        {loadingBackupSettings ? "Loading backup history..." : "No backup snapshots yet. Create your first backup to get started."}
                      </div>
                    )}
                  </div>
                  {backupRecords.length > backupPageSize && (
                    <div className={`flex flex-col items-center justify-between gap-3 border-t px-3 py-3 sm:flex-row ${darkMode ? "border-slate-700 bg-[#0b1420]" : "border-border bg-muted/30"}`}>
                      <span className={`text-xs ${darkMode ? "text-slate-400" : "text-muted-foreground"}`}>
                        Showing {backupRangeStart}–{backupRangeEnd} of {backupRecords.length} backups
                      </span>
                      <div className="flex flex-wrap items-center justify-center gap-2" role="navigation" aria-label="Backup history pagination">
                        <button
                          type="button"
                          onClick={() => setBackupPage((page) => Math.max(page - 1, 1))}
                          disabled={activeBackupPage === 1}
                          className={`rounded-lg border px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-border bg-background text-slate-700 hover:bg-muted"}`}
                        >
                          Previous
                        </button>
                        {Array.from({ length: Math.min(5, totalBackupPages) }, (_, index) => {
                          const firstPage = Math.max(1, Math.min(activeBackupPage - 2, totalBackupPages - 4));
                          const pageNumber = firstPage + index;
                          return (
                            <button
                              key={pageNumber}
                              type="button"
                              onClick={() => setBackupPage(pageNumber)}
                              aria-current={pageNumber === activeBackupPage ? "page" : undefined}
                              className={`size-9 rounded-lg text-xs font-semibold ${pageNumber === activeBackupPage ? "bg-red-700 text-white" : darkMode ? "border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border border-border bg-background text-slate-700 hover:bg-muted"}`}
                            >
                              {pageNumber}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => setBackupPage((page) => Math.min(page + 1, totalBackupPages))}
                          disabled={activeBackupPage === totalBackupPages}
                          className={`rounded-lg border px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-border bg-background text-slate-700 hover:bg-muted"}`}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
    </>
    );
  };

  const togglePermissionDraft = (key, checked) => {
    setPermissionDraft((current) => {
      const nextPermissions = key === "view_only_access" && checked
        ? Object.fromEntries(PERMISSIONS.map(({ key: permissionKey }) => [permissionKey, permissionKey === "view_only_access"]))
        : {
            ...current,
            ...(key !== "view_only_access" && checked ? { view_only_access: false } : {}),
            [key]: checked,
          };
      return normalizePermissions(nextPermissions);
    });
  };

  const savePermissionMatrix = async () => {
    if (!permissionAccount || !permissionDraft) return;
    const saved = await updateUser(permissionAccount, permissionDraft);
    if (saved) {
      toast.success("Customer permissions saved.");
      setPermissionAccount(null);
      setPermissionDraft(null);
    }
  };

  const upgradeCustomerToStaff = async () => {
    if (!permissionAccount || !["skilled_worker", "helper"].includes(upgradeStaffType)) return;
    const accountId = permissionAccount._id || permissionAccount.id;
    setSavingId(accountId);
    try {
      const response = await updateAdminUserAccess(accountId, { role: "skilled_worker", staff_access: { ...defaultStaffAccess(), staff_type: upgradeStaffType } });
      setUsers((current) => current.map((item) => (item._id || item.id) === accountId ? { ...response.user, is_active: true } : item));
      recordActivity(user, `Upgraded ${permissionAccount.first_name} ${permissionAccount.last_name} to staff.`, "Settings");
      toast.success("Customer upgraded to staff.");
      setShowUpgradeConfirm(false);
      setPermissionAccount(null);
      setPermissionDraft(null);
      setUpgradeStaffType("");
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to upgrade customer to staff.");
    } finally {
      setSavingId(null);
    }
  };

  const openPermissionMatrix = (account) => {
    setPermissionAccount(account);
    setPermissionDraft(getPermissions(account));
  };

  const openStaffAccess = (account) => {
    setStaffAccount(account);
    setStaffDraft(normalizeStaffAccess(account.staff_access));
    setExpandedStaffModule(null);
    setCustomSubroleInput("");
    setEditingCustomSubrole("");
    setShowStaffSubroleMenu(false);
  };

  const addCustomSubrole = () => {
    const subrole = customSubroleInput.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!isAdmin || isOwnStaffAccount || !subrole || !staffDraft) return;

    const duplicate = staffDraft.custom_subroles.find((item) => (
      typeof item === "string"
      && item.toLowerCase() === subrole.toLowerCase()
      && item.toLowerCase() !== editingCustomSubrole.toLowerCase()
    ));
    if (duplicate) {
      toast.error("A custom subrole with that name already exists.");
      return;
    }

    const selectedSubrole = subrole;
    setStaffDraft((current) => ({
      ...current,
      subrole: current.subrole?.toLowerCase() === editingCustomSubrole.toLowerCase() || !editingCustomSubrole
        ? selectedSubrole
        : current.subrole,
      custom_subroles: editingCustomSubrole
        ? current.custom_subroles.map((item) => item === editingCustomSubrole ? selectedSubrole : item)
        : [...current.custom_subroles, selectedSubrole],
    }));
    setCustomSubroleInput("");
    setEditingCustomSubrole("");
    toast.success(`${editingCustomSubrole ? "Subrole updated" : "Subrole added"}: ${selectedSubrole}. Save Settings to apply it.`);
  };

  const editCustomSubrole = (subrole) => {
    setEditingCustomSubrole(subrole);
    setCustomSubroleInput(subrole);
    setShowStaffSubroleMenu(false);
  };

  const deleteCustomSubrole = (subrole) => {
    if (!isAdmin || isOwnStaffAccount || !staffDraft) return;
    if (!window.confirm(`Delete the custom subrole "${subrole}"?`)) return;
    setStaffDraft((current) => ({
      ...current,
      subrole: current.subrole?.toLowerCase() === subrole.toLowerCase() ? "" : current.subrole,
      custom_subroles: current.custom_subroles.filter((item) => item.toLowerCase() !== subrole.toLowerCase()),
    }));
    if (editingCustomSubrole.toLowerCase() === subrole.toLowerCase()) {
      setEditingCustomSubrole("");
      setCustomSubroleInput("");
    }
    setShowStaffSubroleMenu(false);
    toast.success(`Subrole deleted: ${subrole}. Save Settings to apply it.`);
  };

  const updateStaffModule = (moduleKey, update) => {
    setStaffDraft((current) => ({
      ...current,
      modules: {
        ...current.modules,
        [moduleKey]: { ...current.modules[moduleKey], ...update },
      },
    }));
  };

  const toggleStaffAction = (moduleKey, actionKey) => {
    setStaffDraft((current) => ({
      ...current,
      modules: {
        ...current.modules,
        [moduleKey]: {
          ...current.modules[moduleKey],
          actions: {
            ...current.modules[moduleKey].actions,
            [actionKey]: !current.modules[moduleKey].actions[actionKey],
          },
        },
      },
    }));
  };

  const saveStaffAccess = async (confirmedTypeChange = false) => {
    if (!isAdmin || !staffAccount || !staffDraft) return;
    const accountId = staffAccount._id || staffAccount.id;
    const originalType = staffAccount.staff_access?.staff_type || "";
    if (staffDraft.staff_type !== originalType && !confirmedTypeChange) {
      setShowStaffTypeConfirm(true);
      return;
    }
    setSavingId(accountId);
    try {
      const response = await updateAdminUserAccess(accountId, { staff_access: staffDraft });
      setUsers((current) => current.map((account) => (account._id || account.id) === accountId ? { ...response.user, is_active: true } : account));
      recordActivity(user, `Updated staff access for ${staffAccount.first_name} ${staffAccount.last_name}.`, "Settings");
      toast.success("Staff access settings saved.");
      setStaffAccount(null);
      setStaffDraft(null);
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to save staff access settings.");
    } finally {
      setSavingId(null);
    }
  };

  const promoteStaffAccountToSuperAdmin = async () => {
    if (!user?.is_super_admin || !superAdminPromotionTarget || !superAdminPromotionPassword) return;
    if (activeSuperAdminCount >= 2) return;
    const target = superAdminPromotionTarget;
    const accountId = target._id || target.id;
    setSavingId(accountId);
    try {
      const response = await promoteStaffToSuperAdmin(accountId, superAdminPromotionPassword);
      setUsers((current) => current.map((account) => (account._id || account.id) === accountId ? response.user : account));
      recordActivity(user, `Promoted ${target.first_name} ${target.last_name} to Super Admin.`, "Settings");
      toast.success(response.message || "Staff member promoted to Super Admin.");
      setSuperAdminPromotionTarget(null);
      setSuperAdminPromotionPassword("");
      setShowSuperAdminPromotionPassword(false);
      setStaffAccount(null);
      setStaffDraft(null);
      setSearch("");
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to promote this staff account.");
    } finally {
      setSavingId(null);
    }
  };

  const convertSecondarySuperAdminToStaff = async () => {
    if (!user?.is_primary_super_admin || !superAdminDemotionTarget || !superAdminDemotionPassword) return;
    const target = superAdminDemotionTarget;
    const accountId = target._id || target.id;
    setSavingId(accountId);
    try {
      const response = await demoteSuperAdminToStaff(accountId, superAdminDemotionPassword);
      setUsers((current) => current.map((account) => (account._id || account.id) === accountId ? response.user : account));
      recordActivity(user, `Converted ${target.first_name} ${target.last_name} from Super Admin to staff.`, "Settings");
      toast.success(response.message || "Super Admin converted to staff.");
      setSuperAdminDemotionTarget(null);
      setSuperAdminDemotionPassword("");
      setShowSuperAdminDemotionPassword(false);
      setSearch("");
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to convert this Super Admin to staff.");
    } finally {
      setSavingId(null);
    }
  };

  const convertStaffToCustomer = async () => {
    if ((!isAdmin && !canManageAccess) || !staffAccount || isOwnStaffAccount) return;
    const accountId = staffAccount._id || staffAccount.id;
    setSavingId(accountId);
    try {
      const response = await updateAdminUserAccess(accountId, { role: "customer" });
      setUsers((current) => current.map((account) => (account._id || account.id) === accountId ? { ...response.user, is_active: true } : account));
      recordActivity(user, `Converted ${staffAccount.first_name} ${staffAccount.last_name} to customer.`, "Settings");
      toast.success("Staff account converted to customer.");
      setShowConvertStaffConfirm(false);
      setStaffAccount(null);
      setStaffDraft(null);
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to convert staff account.");
    } finally {
      setSavingId(null);
    }
  };

  const saveGlobalPermissions = async () => {
    setSavingGlobal(true);
    try {
      const normalizedPermissions = normalizeGlobalCustomerPermissions(globalPermissions);
      const response = await updateSystemSettings({ global_permissions: normalizedPermissions });
      setGlobalPermissions(normalizeGlobalCustomerPermissions(response.global_permissions || normalizedPermissions));
      recordActivity(user, "Saved the global customer permissions profile.", "Settings");
      toast.success("Global profile saved. Individual account permissions were not changed.");
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to save the global permissions profile.");
    } finally {
      setSavingGlobal(false);
    }
  };

  const roleLabel = (role) => {
    if (role === "customer") return "Client";
    if (role === "helper") return "Helper";
    if (role === "staff" || role === "skilled_worker") return "Staff";
    if (role === "admin" || role === "super_admin") return "Super Admin";
    return "Client";
  };

  const getRoleBadgeClasses = (role) => {
    if (role === "customer") return darkMode ? "bg-sky-950/70 text-sky-200" : "bg-sky-100 text-sky-700";
    if (role === "helper") return darkMode ? "bg-violet-950/70 text-violet-200" : "bg-violet-100 text-violet-700";
    if (role === "admin" || role === "super_admin") return darkMode ? "bg-emerald-950/70 text-emerald-200" : "bg-emerald-100 text-emerald-700";
    return darkMode ? "bg-violet-950/70 text-violet-200" : "bg-violet-100 text-violet-700";
  };

  const getModuleAccessLabel = (permissions, isAdmin = false) => {
    if (isAdmin) return "Full Module Access";
    if (permissions.view_only_access) return "View only";
    if (permissions.can_request_orders || permissions.can_estimate_pricing || permissions.can_track_products) return "Customer Portal Matrix";
    return "No access";
  };

  const toggleMaintenanceMode = async () => {
    const nextMode = !maintenanceMode;
    setMaintenanceMode(nextMode);
    setSavingMaintenance(true);
    try {
      const response = await updateSystemSettings({ maintenance_mode: nextMode });
      setMaintenanceMode(response.maintenance_mode === true);
      recordActivity(user, `${nextMode ? "Enabled" : "Disabled"} system maintenance mode.`, "Settings");
      toast.success(nextMode ? "System maintenance mode enabled." : "System maintenance mode disabled.");
    } catch (error) {
      setMaintenanceMode(!nextMode);
      toast.error(error?.data?.message || error?.message || "Unable to update maintenance mode.");
    } finally {
      setSavingMaintenance(false);
    }
  };

  const formatBackupDateShort = (value) => new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const formatBackupTime = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const formatBackupSize = (backup) => {
    const sizeBytes = Number(backup?.sizeBytes);
    if (Number.isFinite(sizeBytes) && sizeBytes > 0) {
      if (sizeBytes < 1024) return `${sizeBytes} B`;
      if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(sizeBytes < 100 * 1024 ? 1 : 0)} KB`;
      return `${(sizeBytes / (1024 * 1024)).toFixed(sizeBytes < 10 * 1024 * 1024 ? 2 : 1)} MB`;
    }

    const sizeInMB = Number(backup?.size);
    if (!Number.isFinite(sizeInMB) || sizeInMB <= 0) return "Under 0.1 MB";
    return `${sizeInMB.toFixed(sizeInMB < 10 ? 2 : 1)} MB`;
  };

  const backupMetrics = useMemo(() => {
    const backups = backupState.backups || [];
    const successfulBackups = backups.filter((backup) => backup.status?.toLowerCase() === "success").length;
    return {
      status: loadingBackupSettings ? "Loading..." : backups.length ? backupState.status || "Success" : "No backups yet",
      lastBackupAt: backupState.lastBackupAt || backups[0]?.date,
      totalBackups: backups.length,
      successRate: backups.length ? Math.round((successfulBackups / backups.length) * 100) : 0,
    };
  }, [backupState, loadingBackupSettings]);

  const backupRecords = backupState.backups || [];
  const totalBackupPages = Math.max(1, Math.ceil(backupRecords.length / backupPageSize));
  const activeBackupPage = Math.min(backupPage, totalBackupPages);
  const paginatedBackups = backupRecords.slice(
    (activeBackupPage - 1) * backupPageSize,
    activeBackupPage * backupPageSize,
  );
  const backupRangeStart = backupRecords.length === 0 ? 0 : (activeBackupPage - 1) * backupPageSize + 1;
  const backupRangeEnd = Math.min(activeBackupPage * backupPageSize, backupRecords.length);

  const persistBackupState = async (nextState) => {
    const payload = {
      backup_schedule: nextState.selectedSchedule || "weekly",
      backup_schedule_time: nextState.scheduleTime || "00:00",
      backup_status: nextState.status || "Success",
      last_backup_at: nextState.lastBackupAt || null,
      backup_history: Array.isArray(nextState.backups) ? nextState.backups : [],
    };

    const response = await updateSystemSettings(payload);
    if (response?.backup_history) {
      setBackupState((current) => ({
        selectedSchedule: response.backup_schedule || nextState.selectedSchedule || "weekly",
        scheduleTime: response.backup_schedule_time || nextState.scheduleTime || "00:00",
        status: response.backup_status || nextState.status || "Success",
        lastBackupAt: response.last_backup_at || nextState.lastBackupAt || null,
        nextBackupAt: response.next_backup_at || current.nextBackupAt || null,
        backups: Array.isArray(response.backup_history) ? response.backup_history : nextState.backups || [],
      }));
    }
    return response;
  };

  const handleScheduleChange = async (scheduleId) => {
    const nextState = { ...backupState, selectedSchedule: scheduleId };
    setBackupState(nextState);
    try {
      await persistBackupState(nextState);
      toast.success(`Backup schedule set to ${backupOptions.find((option) => option.id === scheduleId)?.label || "custom"}.`);
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to update backup schedule.");
      setBackupState(backupState);
    }
  };

  const handleScheduleTimeSave = async () => {
    if (!scheduleTimeDraft) return;
    try {
      await persistBackupState({ ...backupState, scheduleTime: scheduleTimeDraft });
      setShowScheduleTimeModal(false);
      toast.success("Backup time updated.");
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to update backup time.");
    }
  };

  const handleSaveBackupRecoveryPassword = async (event) => {
    event.preventDefault();
    if (savingRecoveryPassword) return;
    if (!isPasswordPolicySatisfied(newRecoveryPassword)) {
      toast.error(PASSWORD_POLICY_MESSAGE);
      return;
    }
    if (newRecoveryPassword !== confirmRecoveryPassword) {
      toast.error("The new recovery passwords do not match.");
      return;
    }

    setSavingRecoveryPassword(true);
    try {
      if (recoveryPasswordResetMode) {
        await resetBackupRecoveryPassword({ code: recoveryPasswordResetCode, new_password: newRecoveryPassword });
      } else {
        await setBackupRecoveryPassword({
          current_password: backupRecoveryConfigured ? recoveryPassword : undefined,
          new_password: newRecoveryPassword,
        });
      }
      setBackupRecoveryConfigured(true);
      setRecoveryPassword(newRecoveryPassword);
      setNewRecoveryPassword("");
      setConfirmRecoveryPassword("");
      setRecoveryPasswordResetCode("");
      setRecoveryPasswordResetMode(false);
      toast.success(recoveryPasswordResetMode ? "Backup recovery password reset." : "Backup recovery password saved.");
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to save the recovery password.");
    } finally {
      setSavingRecoveryPassword(false);
    }
  };

  const handleRequestRecoveryPasswordCode = async () => {
    if (requestingRecoveryPasswordCode || savingRecoveryPassword) return;
    setRequestingRecoveryPasswordCode(true);
    try {
      const response = await requestBackupRecoveryPasswordReset();
      setRecoveryPasswordResetMode(true);
      setRecoveryPasswordResetCode("");
      setRecoveryPassword("");
      setNewRecoveryPassword("");
      setConfirmRecoveryPassword("");
      toast.success(response?.message || "A verification code was sent to your administrator email.");
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to send a recovery password code.");
    } finally {
      setRequestingRecoveryPasswordCode(false);
    }
  };

  const cancelRecoveryPasswordReset = () => {
    setRecoveryPasswordResetMode(false);
    setRecoveryPasswordResetCode("");
    setNewRecoveryPassword("");
    setConfirmRecoveryPassword("");
  };

  const recoveryPasswordsMatch = newRecoveryPassword.length > 0 && newRecoveryPassword === confirmRecoveryPassword;
  const recoveryPasswordConfirmationMismatch = confirmRecoveryPassword.length > 0 && !recoveryPasswordsMatch;
  const recoveryPasswordChecks = [
    { label: "12-128 characters", met: newRecoveryPassword.length >= 12 && newRecoveryPassword.length <= 128 },
    { label: "Uppercase letter", met: /[A-Z]/.test(newRecoveryPassword) },
    { label: "Lowercase letter", met: /[a-z]/.test(newRecoveryPassword) },
    { label: "Number", met: /\d/.test(newRecoveryPassword) },
    { label: "Symbol", met: /[^A-Za-z0-9]/.test(newRecoveryPassword) },
    { label: "Not the default password", met: newRecoveryPassword.length > 0 && newRecoveryPassword.trim().toLowerCase() !== "acgc-2026" },
  ];

  const handleBackupFileSelection = (file) => {
    if (!file) return;
    const filename = file.name.toLowerCase();
    if (!filename.endsWith(".zip") && !filename.endsWith(".json.gz") && !filename.endsWith(".json.gz.enc")) {
      toast.error("Choose an encrypted .zip or a legacy .json.gz system backup file.");
      return;
    }
    if (file.size > 512 * 1024 * 1024) {
      toast.error("Backup files must be 512 MB or smaller.");
      return;
    }
    setBackupImportFile(file);
  };

  const handleBackupNow = async () => {
    if (creatingBackup || loadingBackupSettings) return;
    const backupType = "Full System";

    setCreatingBackup(true);
    try {
      const response = await createSystemBackup(backupType);
      setBackupState((current) => ({
        ...current,
        selectedSchedule: response.backup_schedule || current.selectedSchedule,
        status: response.backup_status || "Success",
        lastBackupAt: response.last_backup_at || response.backup?.date || null,
        backups: Array.isArray(response.backup_history)
          ? response.backup_history
          : [response.backup, ...(current.backups || [])].filter(Boolean),
      }));
      recordActivity(user, `Created an immediate ${backupType.toLowerCase()} backup.`, "Settings");
      toast.success(`${backupType} backup created successfully.`);
    } catch (error) {
      setBackupState((current) => ({ ...current, status: "Failed" }));
      toast.error(error?.data?.message || error?.message || "Unable to create backup.");
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleSyncUploadedBackup = async () => {
    if (restoringBackup || uploadingBackupFile) return;
    let backup = uploadedBackup;
    if (!backup) {
      if (!backupImportFile) return;
      setUploadingBackupFile(true);
      try {
        const response = await uploadSystemBackup(backupImportFile);
        backup = response.backup;
        setUploadedBackup(backup);
        setBackupState((current) => ({
          ...current,
          selectedSchedule: response.backup_schedule || current.selectedSchedule,
          status: response.backup_status || "Success",
          lastBackupAt: response.last_backup_at || backup?.date || null,
          backups: Array.isArray(response.backup_history)
            ? response.backup_history
            : [backup, ...(current.backups || [])].filter(Boolean),
        }));
        recordActivity(user, `Uploaded system backup ${backup?.name || backupImportFile.name}.`, "Settings");
      } catch (error) {
        toast.error(error?.data?.message || error?.message || "Unable to upload backup file.");
        return;
      } finally {
        setUploadingBackupFile(false);
      }
    }
    if (!backup) return;

    restoreDialogTriggerRef.current = document.activeElement;
    setRestoreConfirmation(backup);
  };

  const handleRemoveBackupFile = async () => {
    if (removingBackupFile || uploadingBackupFile || restoringBackup) return;
    if (uploadedBackup) {
      setRemovingBackupFile(true);
      try {
        const response = await deleteSystemBackup(uploadedBackup.id);
        setBackupState((current) => ({
          ...current,
          selectedSchedule: response.backup_schedule || current.selectedSchedule,
          status: response.backup_status || "Success",
          lastBackupAt: response.last_backup_at || null,
          backups: Array.isArray(response.backup_history) ? response.backup_history : current.backups,
        }));
      } catch (error) {
        toast.error(error?.data?.message || error?.message || "Unable to remove uploaded backup.");
        return;
      } finally {
        setRemovingBackupFile(false);
      }
    }

    setUploadedBackup(null);
    setBackupImportFile(null);
    if (backupUploadInputRef.current) backupUploadInputRef.current.value = "";
    toast.success("Backup file removed.");
  };

  const handleDownloadBackup = async (backup) => {
    if (downloadingBackupId !== null) return;
    setDownloadingBackupId(backup.id);
    let downloadUrl;
    let link;
    try {
      const { blob, filename } = await downloadSystemBackup(backup.id);
      downloadUrl = URL.createObjectURL(blob);
      link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      toast.success(`Downloading ${backup.name}.`);
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to download backup.");
    } finally {
      link?.remove();
      if (downloadUrl) window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setDownloadingBackupId(null);
    }
  };

  const handleRestoreBackup = async (backupId) => {
    const backup = (backupState.backups || []).find((item) => item.id === backupId);
    if (!backup) return;
    restoreDialogTriggerRef.current = document.activeElement;
    setRestoreConfirmation(backup);
  };

  const confirmRestoreBackup = async () => {
    if (!restoreConfirmation || restoringBackup) return;
    if (!restoreRecoveryPassword) {
      toast.error("Enter the recovery password to continue.");
      return;
    }
    const backup = restoreConfirmation;
    setRestoringBackup(true);
    try {
      const response = await restoreSystemBackup(backup.id, restoreRecoveryPassword);
      setBackupState({
        selectedSchedule: response.backup_schedule || backupState.selectedSchedule,
        scheduleTime: backupState.scheduleTime || "00:00",
        nextBackupAt: backupState.nextBackupAt,
        status: response.backup_status || "Restored",
        lastBackupAt: response.last_backup_at || backup.date,
        backups: Array.isArray(response.backup_history) ? response.backup_history : backupState.backups,
      });
      recordActivity(user, `Restored backup ${backup.name}.`, "Settings");
      toast.success(`${backup.name} restored. All users have been signed out.`);
      logout();
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to restore backup.");
    } finally {
      setRestoringBackup(false);
      setRestoreConfirmation(null);
      setRestoreRecoveryPassword("");
    }
  };

  const handleDeleteBackup = async (backupId) => {
    const backup = (backupState.backups || []).find((item) => item.id === backupId);
    if (!backup) return;
    deleteDialogTriggerRef.current = document.activeElement;
    setDeleteConfirmation(backup);
  };

  const confirmDeleteBackup = async () => {
    if (!deleteConfirmation || deletingBackup) return;
    const backup = deleteConfirmation;
    setDeletingBackup(true);
    try {
      const response = await deleteSystemBackup(backup.id);
      setBackupState({
        selectedSchedule: response.backup_schedule || backupState.selectedSchedule,
        scheduleTime: backupState.scheduleTime || "00:00",
        nextBackupAt: backupState.nextBackupAt,
        status: response.backup_status || "Success",
        lastBackupAt: response.last_backup_at || null,
        backups: Array.isArray(response.backup_history) ? response.backup_history : [],
      });
      toast.success("Backup deleted.");
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to delete backup.");
    } finally {
      setDeletingBackup(false);
      setDeleteConfirmation(null);
    }
  };

  return (
    <div className={`admin-settings settings-premium flex h-dvh min-h-dvh overflow-hidden ${darkMode ? "dark bg-slate-950 text-slate-100" : "bg-[#eef1f3] text-slate-900"}`}>
      <AppToaster />
      <Sidebar isOpen={isSidebarOpen} onToggle={() => setIsSidebarOpen((open) => !open)} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Navbar />
        <main className="min-w-0 flex-1 min-h-0 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-y-contain p-4 !pr-6 !pb-[calc(10rem+env(safe-area-inset-bottom))] sm:p-6 sm:!pr-6 sm:!pb-[calc(10rem+env(safe-area-inset-bottom))] lg:p-8 lg:!pr-8 lg:!pb-24">
          <AdminPageHeader
            title="System Settings"
            description="Manage customer access, permissions, and account availability."
            statsClassName="grid-cols-1 min-[600px]:grid-cols-3 gap-2 sm:gap-3"
            mobileCompact
            stats={[
              { label: "Users", value: counts.all },
              { label: "Active", value: counts.active, color: "text-emerald-300" },
              { label: "Staff", value: counts.skilled_worker, color: "text-red-300" },
            ]}
          />

          <section className="mt-6 min-w-0 max-w-full overflow-hidden">
            <div className="sm:hidden">
              <CustomerDropdown
                darkMode={darkMode}
                aria-label="Settings section"
                value={activeSettingsTab}
                onChange={(event) => setActiveSettingsTab(event.target.value)}
                className={darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-700"}
              >
                {settingsTabs.map((tab) => <option key={tab.key} value={tab.key}>{tab.label}</option>)}
              </CustomerDropdown>
            </div>
            <div role="tablist" aria-label="Settings tabs" className="hidden min-w-0 items-center gap-1 rounded-2xl border border-border bg-muted/50 p-1.5 dark:border-slate-700 dark:bg-slate-900 sm:inline-flex sm:max-w-full sm:flex-nowrap sm:overflow-x-auto sm:w-auto">
              {settingsTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={activeSettingsTab === tab.key}
                  onClick={() => setActiveSettingsTab(tab.key)}
                  className={cn("relative inline-flex h-auto min-h-10 min-w-0 items-center justify-center whitespace-normal rounded-[11px] border border-transparent px-1 py-2 text-[10px] font-medium leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none sm:h-10 sm:shrink-0 sm:whitespace-nowrap sm:px-5 sm:text-sm", activeSettingsTab === tab.key ? "text-brand dark:text-brand-dark-text" : "text-secondary-foreground hover:bg-background/80 hover:text-foreground dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100")}
                >
                  {activeSettingsTab === tab.key && <motion.span layoutId="settings-tab-indicator" aria-hidden="true" initial={false} transition={{ duration: prefersReducedMotion ? 0 : 0.18 }} className="absolute inset-0 rounded-[11px] border border-brand/50 bg-brand/[0.07] dark:border-brand-dark-text/50 dark:bg-brand-dark-fill/10" />}
                  <span className="relative z-10">{tab.label}</span>
                </button>
              ))}
            </div>
          </section>

          {activeSettingsTab === "user-management" && (
            <>
              {isAdmin && <section className={`mt-7 overflow-hidden rounded-[22px] border shadow-[0_18px_45px_-28px_rgba(15,23,42,0.65)] ${darkMode ? "border-slate-700 bg-slate-900" : "border-red-100 bg-white"}`}>
            <div className={`relative flex min-w-0 items-start justify-between gap-3 border-b px-4 py-4 sm:gap-4 sm:px-6 sm:py-5 ${darkMode ? "border-slate-700 bg-gradient-to-r from-slate-900 via-slate-900 to-red-950/40" : "border-red-100 bg-gradient-to-r from-red-50 via-white to-orange-50"}`}>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-red-900 text-white shadow-lg shadow-red-950/20"><Settings2 size={17} /></div>
                <div className="min-w-0"><p className={`text-[10px] font-black uppercase tracking-[0.2em] ${darkMode ? "text-red-300" : "text-red-700"}`}>Access control</p><h2 className={`mt-1 text-base font-black ${darkMode ? "text-white" : "text-red-950"}`}>Global Customer Permissions</h2><p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Saved globally without changing individual account matrices.</p></div>
              </div>
              <button type="button" onClick={() => setGlobalOpen((open) => !open)} className={`inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border px-2.5 py-2 text-[11px] font-bold transition sm:gap-2 sm:px-4 sm:text-xs ${darkMode ? "border-red-900/70 bg-red-950/50 text-red-200 hover:bg-red-900/60" : "border-red-200 bg-red-100 text-red-900 hover:bg-red-200"}`}>{globalOpen ? "Collapse" : "Manage All"}<ChevronDown size={14} className={`transition-transform ${globalOpen ? "rotate-180" : ""}`} /></button>
            </div>
            {globalOpen && <>
              <div className={`flex min-w-0 items-start justify-between gap-3 border-b px-4 py-3 sm:items-center sm:px-5 sm:py-4 ${darkMode ? "border-slate-800" : "border-slate-100"}`}><div className="min-w-0 flex-1"><p className={`text-[10px] font-black uppercase tracking-[0.18em] ${darkMode ? "text-slate-500" : "text-slate-400"}`}>Global customer access profile</p><p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Choose the global profile; each account's matrix remains independent.</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}>{globalPermissions.view_only_access ? 1 : Object.entries(globalPermissions).filter(([key, enabled]) => key !== "view_only_access" && enabled).length} enabled</span></div>
              <div className="grid gap-2 p-3 sm:gap-3 sm:p-4 md:grid-cols-2">{PERMISSIONS.map((permission, index) => <PermissionSwitch key={permission.key} permission={permission} index={index} checked={permission.key === "view_only_access" ? globalPermissions.view_only_access : !globalPermissions.view_only_access && globalPermissions[permission.key]} disabled={globalPermissions.view_only_access && permission.key !== "view_only_access" && ["can_request_orders", "can_estimate_pricing", "can_track_products", "can_upload_feedback", "show_ratings_homepage"].some((key) => globalPermissions[key])} onChange={(checked) => updateGlobalPermission(permission.key, checked)} darkMode={darkMode} />)}</div>
              <div className={`mx-4 mb-4 flex items-center justify-between gap-4 rounded-2xl border px-4 py-4 ${maintenanceMode ? (darkMode ? "border-amber-700/70 bg-amber-950/40" : "border-amber-300 bg-amber-50") : (darkMode ? "border-slate-700 bg-slate-800/70" : "border-slate-200 bg-slate-50")}`}>
                <div className="flex items-center gap-3"><span className={`h-2.5 w-2.5 rounded-full ${maintenanceMode ? "bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.8)]" : "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.55)]"}`} /><div><p className={`text-xs font-black ${maintenanceMode ? (darkMode ? "text-amber-200" : "text-amber-900") : (darkMode ? "text-slate-200" : "text-slate-700")}`}>System Maintenance Mode</p><p className={`text-[10px] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{maintenanceMode ? "Customer activity is temporarily restricted." : "Platform is operating normally."}</p></div></div>
                <button type="button" role="switch" aria-checked={maintenanceMode} disabled={savingMaintenance} onClick={toggleMaintenanceMode} className={`relative h-6 w-11 shrink-0 rounded-full transition ${maintenanceMode ? "bg-amber-600" : "bg-slate-300"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${maintenanceMode ? "left-[22px]" : "left-1"}`} /></button>
              </div>
              <div className={`flex flex-col gap-3 border-t border-dashed px-4 py-4 sm:flex-row sm:items-center sm:justify-between ${darkMode ? "border-slate-700" : "border-slate-200"}`}><p className={`text-xs ${darkMode ? "text-amber-300" : "text-amber-600"}`}>Account-level Customer Matrix Permissions remain unchanged.</p><button type="button" onClick={saveGlobalPermissions} disabled={savingGlobal} className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-950 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-red-950/20 transition hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-60">{savingGlobal && <Loader2 size={14} className="animate-spin" />}{savingGlobal ? "Saving global profile..." : "Save Global Profile"}</button></div>
            </>}
          </section>}

          <section className={`mt-4 rounded-2xl border p-2 shadow-sm ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
            <div className="lg:hidden">
              <CustomerDropdown darkMode={darkMode}
                aria-label="User category"
                value={activeTab}
                onChange={(event) => setActiveTab(event.target.value)}
                className={`w-full rounded-xl border px-3 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-red-100 ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100 focus:border-red-500" : "border-slate-200 bg-white text-slate-700 focus:border-red-500"}`}
              >
                {userCategoryTabs.map((tab) => (
                  <option key={tab.key} value={tab.key}>{tab.label} ({tab.count})</option>
                ))}
              </CustomerDropdown>
            </div>
            <div role="tablist" aria-label="Filter users by category" className="hidden min-w-0 flex-wrap gap-1.5 lg:flex">
              {userCategoryTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 ${activeTab === tab.key ? (darkMode ? "border-red-700 bg-red-950/60 text-red-100 shadow-sm shadow-black/10" : "border-red-200 bg-red-50 text-red-950 shadow-sm") : (darkMode ? "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white" : "border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-900")}`}
                >
                  {tab.label}
                  <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] tabular-nums ${activeTab === tab.key ? (darkMode ? "bg-red-800 text-red-50" : "bg-red-200 text-red-900") : (darkMode ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-700")}`}>
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-sm">
              <Search size={16} className="absolute left-3 top-3 text-slate-400" />
              <input type="search" name="user-management-search" autoComplete="off" autoCorrect="off" spellCheck={false} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or email..." className={`w-full rounded-xl border py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-100 ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100 placeholder:text-slate-500" : "border-slate-200 bg-white"}`} />
            </div>
            <span className={`text-xs font-semibold ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{loading ? "Loading users..." : `${displayUsers.length} users found`}</span>
          </div>

          <section className={`settings-user-access mt-4 overflow-hidden rounded-[22px] border shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)] ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
            {loading ? <div className={`flex items-center justify-center gap-2 p-16 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}><Loader2 size={18} className="animate-spin" /> Loading user access...</div> : displayUsers.length === 0 ? <div className="p-16 text-center"><ShieldCheck size={30} className="mx-auto text-slate-300" /><p className={`mt-3 text-sm font-semibold ${darkMode ? "text-slate-200" : "text-slate-600"}`}>{activeTab === "helper" ? "No Helper staff found" : activeTab === "skilled_worker" ? "No Skilled Worker staff found" : activeTab.startsWith("subrole:") ? `No ${decodeURIComponent(activeTab.slice("subrole:".length))} staff found` : "No users found"}</p><p className="mt-1 text-xs text-slate-400">Try another search or permission group.</p></div> : <div className="overflow-x-auto"><table className="min-w-[1180px] w-full border-collapse text-left"><thead className={darkMode ? "bg-slate-800/80" : "bg-slate-50"}><tr className={`border-b ${darkMode ? "border-slate-700" : "border-slate-200"}`}><th className={`sticky left-0 z-10 w-[280px] px-5 py-4 text-[10px] font-black uppercase tracking-[0.16em] ${darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-50 text-slate-500"}`}>User</th><th className={`w-[200px] px-3 py-4 text-[10px] font-black uppercase tracking-[0.16em] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Role</th><th className={`w-[240px] px-3 py-4 text-[10px] font-black uppercase tracking-[0.16em] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Module Access</th><th className={`w-[190px] px-3 py-4 text-[10px] font-black uppercase tracking-[0.16em] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Actions</th></tr></thead><tbody className={`divide-y ${darkMode ? "divide-slate-800" : "divide-slate-100"}`}>{paginatedUsers.map((account) => { const accountId = account._id || account.id; const permissions = getPermissions(account); const accountActive = account.is_active !== false; const accountIsAdmin = account.role === "admin" || account.role === "super_admin"; const isStaff = account.role === "skilled_worker"; const staffAccess = isStaff ? normalizeStaffAccess(account.staff_access) : null; const effectivePermissions = accountIsAdmin ? Object.fromEntries(PERMISSIONS.map(({ key }) => [key, true])) : permissions; const enabledStaffModules = isStaff ? STAFF_MODULES.filter(({ key }) => staffAccess.modules[key].enabled).length : 0; const moduleCount = isStaff || accountIsAdmin ? STAFF_MODULES.length : 6; const enabledModuleCount = accountIsAdmin ? moduleCount : isStaff ? enabledStaffModules : Math.min(5, Object.values(effectivePermissions).filter(Boolean).length); const moduleAccessLabel = accountIsAdmin ? "Full Module Access" : isStaff ? `${enabledStaffModules} of ${STAFF_MODULES.length} staff modules` : getModuleAccessLabel(effectivePermissions); const actionClasses = accountIsAdmin ? (darkMode ? "border-emerald-800 bg-emerald-950/70 text-emerald-200" : "border-emerald-200 bg-emerald-50 text-emerald-700") : (darkMode ? "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"); const avatarLetters = `${(account.first_name || account.email || "U").charAt(0)}${(account.last_name || account.email || "U").charAt(0)}`.toUpperCase(); const name = `${account.first_name || ""} ${account.last_name || ""}`.trim() || "User"; return <tr key={accountId} className={`transition ${darkMode ? "hover:bg-slate-800/50" : "hover:bg-slate-50"}`}><td className={`sticky left-0 z-10 px-5 py-4 ${darkMode ? "bg-slate-900" : "bg-white"}`}><div className="flex min-w-[245px] items-center gap-3"><span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-red-700 to-amber-600 text-[10px] font-black text-white shadow-sm ${darkMode ? "ring-1 ring-white/10" : ""}`}>{avatarLetters}</span><div className="min-w-0"><div className="truncate text-[15px] font-semibold text-slate-900 dark:text-slate-200">{name}</div><div className="truncate text-xs text-slate-500">{account.email}</div></div></div></td><td className="px-3 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${getRoleBadgeClasses(account.role)}`}>{accountActive ? roleLabel(account.role) : "Disabled"}</span>{isStaff && <span className={`ml-2 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold ${darkMode ? "border-slate-700 bg-slate-800 text-slate-300" : "border-slate-200 bg-slate-100 text-slate-700"}`}>{getStaffListDesignation(staffAccess)}</span>}</td><td className="px-3 py-4"><div className="flex items-center gap-2"><span className="inline-flex items-center gap-1">{Array.from({ length: moduleCount }).map((_, dotIndex) => (<span key={dotIndex} className={`h-2.5 w-2.5 rounded-full ${dotIndex < enabledModuleCount ? "bg-red-700" : darkMode ? "bg-slate-600" : "bg-slate-300"}`} />))}</span><span className={`text-xs ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{moduleAccessLabel}</span></div></td><td className="px-3 py-4"><div className="flex items-center justify-end">{accountIsAdmin ? (account.role === "super_admin" && user?.is_primary_super_admin === true && !account.is_admin_account ? <button type="button" onClick={() => { setSuperAdminDemotionTarget(account); setSuperAdminDemotionPassword(""); setShowSuperAdminDemotionPassword(false); setSearch(""); }} disabled={!accountActive} className="inline-flex items-center justify-center rounded-xl border border-emerald-200 bg-emerald-100 px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-200 disabled:opacity-50">Convert to Staff</button> : <span className={`inline-flex min-w-[120px] items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold ${actionClasses}`}>Full Access</span>) : isStaff ? <button type="button" onClick={() => openStaffAccess(account)} className={`inline-flex min-w-[120px] items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold transition ${actionClasses}`} aria-label={`Manage access for ${name}`}>Manage Access</button> : canManageAccess ? <button type="button" onClick={() => openPermissionMatrix(account)} className={`inline-flex min-w-[120px] items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold transition ${actionClasses}`} aria-label={`View permissions for ${name}`}>View Permissions</button> : <span className="px-3 py-2 text-xs text-slate-400">Read Only</span>}</div></td></tr>; })}</tbody></table></div>}
          </section>
          {!loading && displayUsers.length > 0 && (
            <div className="mt-3 space-y-3 md:hidden">
              {paginatedUsers.map((account) => {
                const accountIsAdmin = account.role === "admin" || account.role === "super_admin";
                const isStaff = account.role === "skilled_worker";
                const permissions = getPermissions(account);
                const staffAccess = isStaff ? normalizeStaffAccess(account.staff_access) : null;
                const enabledStaffModules = isStaff ? STAFF_MODULES.filter(({ key }) => staffAccess.modules[key].enabled).length : 0;
                const moduleAccessLabel = accountIsAdmin
                  ? "Full Module Access"
                  : isStaff
                    ? `${enabledStaffModules} of ${STAFF_MODULES.length} staff modules`
                    : getModuleAccessLabel(permissions);
                const accountActive = account.is_active !== false;
                const name = `${account.first_name || ""} ${account.last_name || ""}`.trim() || "User";
                const actionClasses = accountIsAdmin
                  ? (darkMode ? "border-emerald-800 bg-emerald-950/70 text-emerald-200" : "border-emerald-200 bg-emerald-50 text-emerald-700")
                  : (darkMode ? "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100");

                return (
                  <article key={account._id || account.id} className={`rounded-2xl border p-4 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-red-700 to-amber-600 text-xs font-black text-white">
                          {`${(account.first_name || account.email || "U").charAt(0)}${(account.last_name || account.email || "U").charAt(0)}`.toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className={`truncate text-sm font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{name}</p>
                          <p className="break-all text-xs text-slate-500">{account.email}</p>
                          {isStaff && <span className={`mt-1 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold ${darkMode ? "border-slate-700 bg-slate-800 text-slate-300" : "border-slate-200 bg-slate-100 text-slate-700"}`}>{getStaffListDesignation(staffAccess)}</span>}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${getRoleBadgeClasses(account.role)}`}>
                        {accountActive ? roleLabel(account.role) : "Disabled"}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
                      <span className="flex shrink-0 items-center gap-1" aria-label={moduleAccessLabel}>
                        {Array.from({ length: isStaff || accountIsAdmin ? STAFF_MODULES.length : 6 }).map((_, dotIndex) => (
                          <span key={dotIndex} className={`size-2 rounded-full ${dotIndex < (accountIsAdmin ? STAFF_MODULES.length : isStaff ? enabledStaffModules : Math.min(5, Object.values(permissions).filter(Boolean).length)) ? "bg-red-700" : darkMode ? "bg-slate-600" : "bg-slate-300"}`} />
                        ))}
                      </span>
                      <span className={`min-w-0 text-xs ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{moduleAccessLabel}</span>
                    </div>
                    <div className="mt-3 flex justify-end">
                      {accountIsAdmin ? (account.role === "super_admin" && user?.is_primary_super_admin === true && !account.is_admin_account ? <button type="button" onClick={() => { setSuperAdminDemotionTarget(account); setSuperAdminDemotionPassword(""); setShowSuperAdminDemotionPassword(false); setSearch(""); }} disabled={!accountActive} className="inline-flex items-center justify-center rounded-xl border border-emerald-200 bg-emerald-100 px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-200 disabled:opacity-50">Convert to Staff</button> : <span className={`inline-flex items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold ${actionClasses}`}>Full Access</span>) : isStaff ? (
                        <button type="button" onClick={() => openStaffAccess(account)} className={`inline-flex items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold transition ${actionClasses}`} aria-label={`Manage access for ${name}`}>Manage Access</button>
                      ) : canManageAccess ? (
                        <button type="button" onClick={() => openPermissionMatrix(account)} className={`inline-flex items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold transition ${actionClasses}`} aria-label={`View permissions for ${name}`}>View Permissions</button>
                      ) : (
                        <span className="px-3 py-2 text-xs text-slate-400">Read Only</span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {renderListPagination(displayUsers.length, currentUserManagementPage, userManagementPageCount, setUserManagementPage)}
            </>
          )}

          {activeSettingsTab === "ordering-restriction" && isAdmin && (
            <section className={`mt-7 overflow-hidden rounded-[22px] border shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)] ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`} aria-labelledby="restricted-customers-heading">
              <header className={`flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6 ${darkMode ? "border-slate-700 bg-amber-950/20" : "border-amber-200 bg-amber-50/70"}`}>
                <div>
                  <h2 id="restricted-customers-heading" className={`text-base font-bold ${darkMode ? "text-amber-200" : "text-amber-950"}`}>Online ordering restrictions</h2>
                  <p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-600"}`}>Review customers under the 7-day cooldown and remove a restriction early when appropriate.</p>
                </div>
                <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${darkMode ? "bg-amber-900/60 text-amber-100" : "bg-amber-100 text-amber-900"}`}>{restrictedCustomers.length} restricted</span>
              </header>
              <div className={`border-b px-5 py-4 sm:px-6 ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                <label htmlFor="ordering-restriction-search" className="sr-only">Search restricted customers</label>
                <div className="relative w-full sm:max-w-md">
                  <Search size={16} className="pointer-events-none absolute left-3 top-3 text-slate-400" aria-hidden="true" />
                  <input
                    id="ordering-restriction-search"
                    type="search"
                    value={restrictionSearch}
                    onChange={(event) => setRestrictionSearch(event.target.value)}
                    placeholder="Search by customer name, email, username, or phone..."
                    className={`w-full rounded-xl border py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-100 ${darkMode ? "border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500" : "border-slate-200 bg-white text-slate-800 placeholder:text-slate-400"}`}
                  />
                </div>
              </div>
              {filteredRestrictedCustomers.length === 0 ? (
                <div className="px-5 py-14 text-center">
                  {restrictedCustomers.length === 0 ? <CircleCheck size={30} className="mx-auto text-emerald-500" aria-hidden="true" /> : <Search size={28} className="mx-auto text-slate-400" aria-hidden="true" />}
                  <p className={`mt-3 text-sm font-semibold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{restrictedCustomers.length === 0 ? "No customers are currently restricted" : "No matching restricted customers"}</p>
                  <p className="mt-1 text-xs text-slate-500">{restrictedCustomers.length === 0 ? "Customers who reach three cancellations will appear here for the duration of their cooldown." : "Try another name, email, username, or phone number."}</p>
                </div>
              ) : (
                <div className={`divide-y ${darkMode ? "divide-slate-800" : "divide-slate-100"}`}>
                  {paginatedRestrictedCustomers.map((account) => {
                    const accountId = account._id || account.id;
                    const customerName = `${account.first_name || "Customer"} ${account.last_name || ""}`.trim();
                    const cooldownDate = new Date(account.online_order_cooldown_until);
                    return (
                      <div key={accountId} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                        <div className="min-w-0">
                          <p className={`truncate text-sm font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{customerName}</p>
                          <p className={`truncate text-xs ${darkMode ? "text-slate-400" : "text-slate-600"}`}>{account.email}</p>
                          <p className={`mt-1 text-xs font-medium ${darkMode ? "text-amber-200" : "text-amber-800"}`}>Restricted until {cooldownDate.toLocaleDateString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric" })}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setRestrictionConfirmation(account)}
                          disabled={savingId === accountId}
                          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-red-700 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
                        >
                          {savingId === accountId ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} aria-hidden="true" />}
                          Remove restriction
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {renderListPagination(filteredRestrictedCustomers.length, currentOrderingRestrictionPage, orderingRestrictionPageCount, setOrderingRestrictionPage)}
            </section>
          )}

          {renderBackupRecovery(backupMetrics)}

          {permissionAccount && permissionDraft && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) { setPermissionAccount(null); setPermissionDraft(null); } }}>
            <section role="dialog" aria-modal="true" aria-labelledby="customer-matrix-title" className={`access-control-dialog w-full max-w-[620px] overflow-hidden rounded-xl border shadow-2xl ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
              <header className={`flex items-center justify-between border-b px-6 py-5 ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-black text-sky-700">{`${(permissionAccount.first_name || "C").charAt(0)}${(permissionAccount.last_name || "T").charAt(0)}`.toUpperCase()}</span>
                  <div className="min-w-0"><h2 id="customer-matrix-title" className={`truncate text-base font-bold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Customer Matrix Permissions</h2><p className={`mt-1 truncate font-mono text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{`${permissionAccount.first_name || "Customer"} ${permissionAccount.last_name || ""}`.trim()} · Client Profile</p></div>
                </div>
                <button type="button" onClick={() => { setPermissionAccount(null); setPermissionDraft(null); }} aria-label="Close permissions" className={`rounded-full p-2 transition ${darkMode ? "text-slate-400 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"}`}><X size={16} /></button>
              </header>
              <div className="px-6 py-4">
                <p className={`mb-4 text-sm ${darkMode ? "text-slate-400" : "text-slate-600"}`}>Toggle specific baseline visibility rules for this customer portal view layout configuration.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {PERMISSIONS.map((permission) => {
                    const checked = permissionDraft[permission.key] === true;
                    return <div key={permission.key} className={`access-control-row flex min-h-[88px] items-center justify-between gap-3 rounded-md border px-3.5 py-3 ${checked ? (darkMode ? "border-red-900/70 bg-red-950/30" : "border-red-200 bg-red-50") : (darkMode ? "border-slate-700 bg-slate-800/50" : "border-slate-200 bg-slate-50")}`}>
                      <div className="min-w-0"><p className={`text-sm font-semibold ${darkMode ? "text-slate-200" : "text-slate-800"}`}>{permission.label}</p><p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{permission.description}</p></div>
                      <button type="button" role="switch" aria-label={permission.label} aria-checked={checked} disabled={savingId === (permissionAccount._id || permissionAccount.id)} onClick={() => togglePermissionDraft(permission.key, !checked)} className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed ${checked ? "bg-red-900" : darkMode ? "bg-slate-600" : "bg-slate-300"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${checked ? "left-[22px]" : "left-1"}`} /></button>
                    </div>;
                  })}
                </div>
              </div>
              <footer className={`flex flex-col-reverse gap-2 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between ${darkMode ? "border-slate-800 bg-slate-800/50" : "border-slate-100 bg-slate-50"}`}>
                {isAdmin && permissionAccount.role === "customer" && <button type="button" onClick={() => { setUpgradeStaffType(""); setShowUpgradeConfirm(true); }} disabled={savingId === (permissionAccount._id || permissionAccount.id)} className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60">↑ Upgrade to Staff</button>}
                <div className="flex justify-end gap-2"><button type="button" onClick={() => { setPermissionAccount(null); setPermissionDraft(null); }} disabled={savingId === (permissionAccount._id || permissionAccount.id)} className={`rounded-md border px-4 py-2.5 text-sm font-medium ${darkMode ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-white"}`}>Cancel</button><button type="button" onClick={savePermissionMatrix} disabled={savingId === (permissionAccount._id || permissionAccount.id)} className="inline-flex min-w-28 items-center justify-center gap-2 rounded-md bg-red-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-900 disabled:opacity-60">{savingId === (permissionAccount._id || permissionAccount.id) ? <Loader2 size={15} className="animate-spin" /> : null}Save Matrix</button></div>
              </footer>
            </section>
          </div>}
          {staffAccount && staffDraft && <div className="mobile-fullscreen-overlay fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) { setStaffAccount(null); setStaffDraft(null); } }}>
            <section role="dialog" aria-modal="true" aria-labelledby="staff-access-title" className={`access-control-dialog mobile-fullscreen-dialog flex max-h-[92vh] w-full max-w-[620px] flex-col overflow-hidden rounded-xl border shadow-2xl ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
              <header className={`flex min-w-0 items-start justify-between gap-3 border-b px-4 py-3 sm:items-center sm:px-5 sm:py-4 ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                <div><h2 id="staff-access-title" className={`text-base font-bold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Staff Access Control</h2><p className={`mt-1 text-xs font-mono ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{`${staffAccount.first_name || "Staff"} ${staffAccount.last_name || ""}`.trim()} · Permission Matrix</p></div>
                <button type="button" onClick={() => { setStaffAccount(null); setStaffDraft(null); }} aria-label="Close staff access settings" className={`rounded-full p-2 ${darkMode ? "text-slate-400 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"}`}><X size={16} /></button>
              </header>
              <div className="overflow-y-auto">
                {(isOwnStaffAccount || !isAdmin) && <p role="status" className={`mx-5 mt-4 rounded-md border px-3 py-2 text-xs ${darkMode ? "border-amber-800 bg-amber-950/30 text-amber-200" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{isOwnStaffAccount ? "You are currently viewing your own profile. Modifying your own permissions is disabled to prevent accidental lockout." : "Staff access is read-only here. Only a Super Admin can change staff permissions."}</p>}
                <section className={`border-b px-5 py-4 ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                  <p className={`mb-2 text-[10px] font-black uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Staff Subrole Designation</p>
                  <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
                    <div className="relative min-w-0">
                      <button type="button" aria-haspopup="listbox" aria-expanded={showStaffSubroleMenu} disabled={!isAdmin || isOwnStaffAccount} onClick={() => setShowStaffSubroleMenu((open) => !open)} className={`flex h-9 w-full items-center justify-between rounded-md border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60 ${darkMode ? "border-slate-700 bg-slate-800 text-slate-100" : "border-slate-200 bg-white text-slate-800"}`}>
                        <span className="truncate">{staffDraft.custom_subroles.find((item) => typeof item === "string" && item.toLowerCase() === staffDraft.subrole?.toLowerCase()) || (staffDraft.staff_type === "skilled_worker" ? "Skilled Worker" : staffDraft.staff_type === "helper" ? "Helper" : "Select staff type")}</span>
                        <ChevronDown size={15} className={`transition-transform ${showStaffSubroleMenu ? "rotate-180" : ""}`} aria-hidden="true" />
                      </button>
                      {showStaffSubroleMenu && <div role="listbox" aria-label="Staff type and custom subroles" className={`absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border py-1 shadow-xl ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-300 bg-white"}`}>
                        {[{ value: "skilled_worker", label: "Skilled Worker" }, { value: "helper", label: "Helper" }].map((type) => <button key={type.value} type="button" role="option" aria-selected={staffDraft.staff_type === type.value} onClick={() => { setStaffDraft((current) => ({ ...current, staff_type: type.value })); setShowStaffSubroleMenu(false); }} className={`block w-full px-3 py-2 text-left text-sm ${staffDraft.staff_type === type.value ? darkMode ? "bg-blue-700 text-white" : "bg-blue-600 text-white" : darkMode ? "text-slate-200 hover:bg-slate-800" : "text-slate-800 hover:bg-slate-100"}`}>{type.label}</button>)}
                        {staffDraft.custom_subroles.length > 0 && <div className={`mt-1 border-t pt-1 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                          <p className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${darkMode ? "text-slate-500" : "text-slate-400"}`}>Custom subroles</p>
                          {staffDraft.custom_subroles.filter((subrole) => typeof subrole === "string" && subrole.trim()).map((subrole) => <div key={subrole} className={`flex items-center gap-1 px-2 py-1 ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-50"}`}>
                            <button type="button" role="option" aria-selected={staffDraft.subrole?.toLowerCase() === subrole.toLowerCase()} onClick={() => { setStaffDraft((current) => ({ ...current, subrole })); setShowStaffSubroleMenu(false); }} className={`min-w-0 flex-1 truncate rounded px-1 py-1 text-left text-sm ${staffDraft.subrole?.toLowerCase() === subrole.toLowerCase() ? darkMode ? "text-sky-300" : "text-sky-700" : darkMode ? "text-slate-200" : "text-slate-700"}`}>{subrole}</button>
                            {isAdmin && !isOwnStaffAccount && <>
                              <button type="button" onClick={() => editCustomSubrole(subrole)} aria-label={`Edit custom subrole ${subrole}`} title="Edit subrole" className={`rounded p-1.5 ${darkMode ? "text-slate-300 hover:bg-slate-700" : "text-slate-600 hover:bg-slate-200"}`}><Pencil size={14} aria-hidden="true" /></button>
                              <button type="button" onClick={() => deleteCustomSubrole(subrole)} aria-label={`Delete custom subrole ${subrole}`} title="Delete subrole" className={`rounded p-1.5 ${darkMode ? "text-red-300 hover:bg-red-950/60" : "text-red-700 hover:bg-red-100"}`}><Trash2 size={14} aria-hidden="true" /></button>
                            </>}
                          </div>)}
                        </div>}
                      </div>}
                    </div>
                    <div className="flex min-w-0 gap-2">
                    <input
                      type="text"
                      value={customSubroleInput}
                      maxLength={40}
                      disabled={!isAdmin || isOwnStaffAccount}
                      onChange={(event) => setCustomSubroleInput(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustomSubrole(); } }}
                      placeholder="Add custom subrole..."
                      className={`h-9 min-w-0 flex-1 rounded-md border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60 ${darkMode ? "border-slate-700 bg-slate-800 text-slate-100 placeholder:text-slate-500" : "border-slate-200 bg-white text-slate-800 placeholder:text-slate-400"}`}
                    />
                    {isAdmin && !isOwnStaffAccount && <button type="button" onClick={addCustomSubrole} disabled={!customSubroleInput.trim()} className={`h-9 rounded-md border px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${darkMode ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>{editingCustomSubrole ? "Save" : "Add"}</button>}
                    </div>
                  </div>
                </section>
                <section className="px-5 py-4">
                  <div className={`access-control-row flex min-h-[76px] items-center justify-between gap-3 rounded-md border px-3.5 py-3 ${staffDraft.hide_payment_amounts ? (darkMode ? "border-red-900/70 bg-red-950/30" : "border-red-200 bg-red-50") : (darkMode ? "border-slate-700 bg-slate-800/50" : "border-slate-200 bg-slate-50")}`}>
                    <div className="min-w-0"><p className={`text-sm font-semibold ${darkMode ? "text-slate-200" : "text-slate-800"}`}>Hide payment amounts</p><p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Mask money values in staff payment and order views. Payment status remains visible.</p></div>
                    <button type="button" role="switch" aria-label="Hide payment amounts" aria-checked={staffDraft.hide_payment_amounts} disabled={!isAdmin || isOwnStaffAccount} onClick={() => setStaffDraft((current) => ({ ...current, hide_payment_amounts: !current.hide_payment_amounts }))} className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${staffDraft.hide_payment_amounts ? "bg-red-900" : darkMode ? "bg-slate-600" : "bg-slate-300"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${staffDraft.hide_payment_amounts ? "left-[22px]" : "left-1"}`} /></button>
                  </div>
                </section>
                <section className="px-5 py-4">
                  <h3 className={`text-[10px] font-black uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Module System Permissions</h3>
                  <p className={`mb-3 mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Enable modules and configure their individual actions.</p>
                  <div className="space-y-2">
                    {STAFF_MODULES.map((module) => {
                      const moduleAccess = staffDraft.modules[module.key];
                      const isExpanded = expandedStaffModule === module.key;
                      return <div key={module.key} className={`access-control-row rounded-md border ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                        <div className="flex min-h-11 items-center gap-3 px-3">
                          <span className={`min-w-0 flex-1 text-xs font-semibold ${darkMode ? "text-slate-200" : "text-slate-800"}`}>{module.label}</span>
                          <button type="button" onClick={() => setExpandedStaffModule(isExpanded ? null : module.key)} className={`whitespace-nowrap text-[10px] font-medium ${darkMode ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-800"}`} aria-expanded={isExpanded}>{isExpanded ? "▲ Hide Sub-actions" : "▼ Manage Sub-actions"}</button>
                          <button type="button" role="switch" aria-label={`${module.label} module`} aria-checked={moduleAccess.enabled} disabled={!isAdmin || isOwnStaffAccount} onClick={() => updateStaffModule(module.key, { enabled: !moduleAccess.enabled })} className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${moduleAccess.enabled ? "bg-red-900" : darkMode ? "bg-slate-600" : "bg-slate-300"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${moduleAccess.enabled ? "left-[18px]" : "left-0.5"}`} /></button>
                        </div>
                        {isExpanded && <div className={`grid grid-cols-1 gap-2 border-t p-3 sm:grid-cols-2 ${darkMode ? "border-slate-700 bg-slate-800/40" : "border-slate-100 bg-slate-50"}`}>
                          {module.actions.map((action) => <div key={action.key} className={`access-control-action flex min-h-8 items-center justify-between gap-3 rounded-sm px-2.5 ${darkMode ? "bg-slate-900/70" : "bg-white"} ${moduleAccess.enabled ? (darkMode ? "text-slate-300" : "text-slate-700") : "opacity-50"}`}><span className="text-xs">{action.label}</span><button type="button" role="switch" aria-label={`${module.label}: ${action.label}`} aria-checked={moduleAccess.actions[action.key]} disabled={!isAdmin || isOwnStaffAccount || !moduleAccess.enabled} onClick={() => toggleStaffAction(module.key, action.key)} className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${moduleAccess.actions[action.key] ? "bg-red-900" : darkMode ? "bg-slate-600" : "bg-slate-300"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${moduleAccess.actions[action.key] ? "left-[18px]" : "left-0.5"}`} /></button></div>)}
                        </div>}
                      </div>;
                    })}
                  </div>
                </section>
              </div>
              <footer className={`flex flex-col-reverse gap-2 border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-between ${darkMode ? "border-slate-800 bg-slate-800/40" : "border-slate-100 bg-slate-50"}`}>
                {user?.is_super_admin === true && !isOwnStaffAccount && <button type="button" onClick={() => { setSuperAdminPromotionTarget(staffAccount); setSuperAdminPromotionPassword(""); }} disabled={activeSuperAdminCount >= 2 || savingId === (staffAccount._id || staffAccount.id)} title={activeSuperAdminCount >= 2 ? "The maximum limit of 2 Super Admin accounts has been reached." : undefined} className={`rounded-md border px-3 py-2 text-xs font-semibold transition disabled:opacity-50 ${darkMode ? "border-emerald-700 bg-emerald-950/70 text-emerald-200 hover:bg-emerald-900" : "border-emerald-200 bg-emerald-100 text-emerald-800 hover:bg-emerald-200"}`}>Promote to Super Admin</button>}
                {(isAdmin || canManageAccess) && !isOwnStaffAccount && <button type="button" onClick={() => setShowConvertStaffConfirm(true)} disabled={savingId === (staffAccount._id || staffAccount.id)} className={`rounded-md border px-3 py-2 text-xs font-semibold transition disabled:opacity-50 ${darkMode ? "border-red-500 bg-red-700 text-white hover:bg-red-600" : "border-red-200 text-red-700 hover:bg-red-50"}`}>↓ Convert to Customer</button>}
                <div className="flex justify-end gap-2"><button type="button" onClick={() => { setStaffAccount(null); setStaffDraft(null); }} className={`rounded-md border px-4 py-2 text-sm ${darkMode ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-white"}`}>Close</button>{isAdmin && !isOwnStaffAccount && <button type="button" onClick={saveStaffAccess} disabled={savingId === (staffAccount._id || staffAccount.id)} className="inline-flex min-w-28 items-center justify-center gap-2 rounded-md bg-red-950 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-60">{savingId === (staffAccount._id || staffAccount.id) ? <Loader2 size={14} className="animate-spin" /> : null}Save Settings</button>}</div>
              </footer>
            </section>
          </div>}
          {restrictionConfirmation && <div
            className="fixed inset-0 z-[115] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
              const confirmationId = restrictionConfirmation._id || restrictionConfirmation.id;
              if (event.target === event.currentTarget && savingId !== confirmationId) setRestrictionConfirmation(null);
            }}
          >
            <section role="alertdialog" aria-modal="true" aria-labelledby="remove-restriction-title" aria-describedby="remove-restriction-description" className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
              <div className={`flex size-11 items-center justify-center rounded-xl ${darkMode ? "bg-amber-950/60 text-amber-300" : "bg-amber-100 text-amber-800"}`}>
                <RotateCcw size={20} aria-hidden="true" />
              </div>
              <h2 id="remove-restriction-title" className={`mt-4 text-lg font-bold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Remove online ordering restriction?</h2>
              <p id="remove-restriction-description" className={`mt-2 text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                Remove the 7-day restriction for {`${restrictionConfirmation.first_name || "this customer"} ${restrictionConfirmation.last_name || ""}`.trim()}? They will be able to place orders online immediately. Their cancellation history will remain unchanged.
              </p>
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setRestrictionConfirmation(null)}
                  disabled={savingId === (restrictionConfirmation._id || restrictionConfirmation.id)}
                  className={`rounded-lg border px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${darkMode ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
                >Cancel</button>
                <button
                  type="button"
                  onClick={() => handleUnrestrictCustomer(restrictionConfirmation)}
                  disabled={savingId === (restrictionConfirmation._id || restrictionConfirmation.id)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingId === (restrictionConfirmation._id || restrictionConfirmation.id) && <Loader2 size={15} className="animate-spin" />}
                  Remove restriction
                </button>
              </div>
            </section>
          </div>}
          {showUpgradeConfirm && permissionAccount && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
            <section role="alertdialog" aria-modal="true" aria-labelledby="upgrade-confirm-title" aria-describedby="upgrade-confirm-description" className={`w-full max-w-md rounded-xl border p-6 shadow-2xl ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
              <h2 id="upgrade-confirm-title" className={`text-lg font-bold leading-tight ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Upgrade Customer to Operational Staff?</h2>
              <p id="upgrade-confirm-description" className={`mt-3 text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>This will change {`${permissionAccount.first_name || "this customer"} ${permissionAccount.last_name || ""}`.trim()}'s role to Staff. You can still customize their customer portal permissions separately.</p>
              <fieldset className="mt-5 space-y-2">
                <legend className={`mb-2 text-xs font-bold ${darkMode ? "text-slate-300" : "text-slate-700"}`}>Staff type</legend>
                {[{ value: "skilled_worker", label: "Skilled Worker" }, { value: "helper", label: "Helper" }].map((type) => <label key={type.value} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm ${upgradeStaffType === type.value ? darkMode ? "border-sky-700 bg-sky-950/40 text-sky-100" : "border-sky-300 bg-sky-50 text-sky-900" : darkMode ? "border-slate-700 text-slate-300" : "border-slate-200 text-slate-700"}`}><input type="radio" name="upgrade-staff-type" value={type.value} checked={upgradeStaffType === type.value} onChange={(event) => setUpgradeStaffType(event.target.value)} />{type.label}</label>)}
              </fieldset>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={() => { setShowUpgradeConfirm(false); setUpgradeStaffType(""); }} disabled={savingId === (permissionAccount._id || permissionAccount.id)} className={`rounded-md border px-4 py-2.5 text-sm font-medium ${darkMode ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>Cancel</button>
                <button type="button" onClick={upgradeCustomerToStaff} disabled={!upgradeStaffType || savingId === (permissionAccount._id || permissionAccount.id)} className="rounded-md bg-red-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-60">{savingId === (permissionAccount._id || permissionAccount.id) ? "Upgrading..." : "Confirm Upgrade"}</button>
              </div>
            </section>
          </div>}
          {showConvertStaffConfirm && staffAccount && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && savingId !== (staffAccount._id || staffAccount.id)) setShowConvertStaffConfirm(false); }}>
            <section role="alertdialog" aria-modal="true" aria-labelledby="convert-staff-confirm-title" aria-describedby="convert-staff-confirm-description" className={`w-full max-w-md rounded-xl border p-6 shadow-2xl ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
              <h2 id="convert-staff-confirm-title" className={`text-lg font-bold leading-tight ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Convert Staff to Customer?</h2>
              <p id="convert-staff-confirm-description" className={`mt-3 text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Are you sure you want to convert {`${staffAccount.first_name || "this staff member"} ${staffAccount.last_name || ""}`.trim()} to a customer account?</p>
              <div className="mt-6 flex justify-end gap-2">
                <button type="button" onClick={() => setShowConvertStaffConfirm(false)} disabled={savingId === (staffAccount._id || staffAccount.id)} className={`rounded-md border px-4 py-2.5 text-sm font-medium ${darkMode ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>Cancel</button>
                <button type="button" onClick={convertStaffToCustomer} disabled={savingId === (staffAccount._id || staffAccount.id)} className="rounded-md bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60">{savingId === (staffAccount._id || staffAccount.id) ? "Converting..." : "Confirm Conversion"}</button>
              </div>
            </section>
          </div>}
          {showStaffTypeConfirm && staffAccount && staffDraft && <div className="fixed inset-0 z-[125] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && savingId !== (staffAccount._id || staffAccount.id)) setShowStaffTypeConfirm(false); }}>
            <section role="alertdialog" aria-modal="true" aria-labelledby="staff-type-confirm-title" aria-describedby="staff-type-confirm-description" className={`w-full max-w-md rounded-xl border p-6 shadow-2xl ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
              <h2 id="staff-type-confirm-title" className={`text-lg font-bold leading-tight ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Change Staff Type?</h2>
              <p id="staff-type-confirm-description" className={`mt-3 text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Change {`${staffAccount.first_name || "this staff member"} ${staffAccount.last_name || ""}`.trim()}'s type to <strong>{staffDraft.staff_type === "helper" ? "Helper" : "Skilled Worker"}</strong>?</p>
              <div className="mt-6 flex justify-end gap-2">
                <button type="button" onClick={() => setShowStaffTypeConfirm(false)} disabled={savingId === (staffAccount._id || staffAccount.id)} className={`rounded-md border px-4 py-2.5 text-sm font-medium ${darkMode ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>Cancel</button>
                <button type="button" onClick={() => { setShowStaffTypeConfirm(false); void saveStaffAccess(true); }} disabled={savingId === (staffAccount._id || staffAccount.id)} className="rounded-md bg-red-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-60">Confirm Change</button>
              </div>
            </section>
          </div>}
          {superAdminPromotionTarget && <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && savingId !== (superAdminPromotionTarget._id || superAdminPromotionTarget.id)) { setSuperAdminPromotionTarget(null); setSuperAdminPromotionPassword(""); setShowSuperAdminPromotionPassword(false); } }}>
            <section role="alertdialog" aria-modal="true" aria-labelledby="promote-super-admin-title" aria-describedby="promote-super-admin-description" className={`w-full max-w-lg rounded-2xl border p-6 shadow-2xl ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
              <h2 id="promote-super-admin-title" className={`text-lg font-bold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Promote to Super Admin?</h2>
              <p className={`mt-3 text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>You are promoting <strong>{`${superAdminPromotionTarget.first_name || "Staff"} ${superAdminPromotionTarget.last_name || ""}`.trim()}</strong>, whose current role is Staff. This grants Super Admin privileges. The system allows a maximum of two active Super Admin accounts.</p>
              <label className={`mt-5 grid gap-1.5 text-sm font-medium ${darkMode ? "text-slate-300" : "text-slate-700"}`}>Your current password
                <span className="relative block">
                  <input type={showSuperAdminPromotionPassword ? "text" : "password"} name="super-admin-promotion-confirmation" autoComplete="new-password" value={superAdminPromotionPassword} onChange={(event) => setSuperAdminPromotionPassword(event.target.value)} disabled={savingId === (superAdminPromotionTarget._id || superAdminPromotionTarget.id)} className={`h-10 w-full rounded-lg border px-3 pr-11 text-sm outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`} />
                  <button type="button" onClick={() => setShowSuperAdminPromotionPassword((visible) => !visible)} disabled={savingId === (superAdminPromotionTarget._id || superAdminPromotionTarget.id)} aria-label={showSuperAdminPromotionPassword ? "Hide current password" : "Show current password"} aria-pressed={showSuperAdminPromotionPassword} className={`absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center ${darkMode ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-800"}`}>
                    {showSuperAdminPromotionPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                  </button>
                </span>
              </label>
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => { setSuperAdminPromotionTarget(null); setSuperAdminPromotionPassword(""); setShowSuperAdminPromotionPassword(false); }} disabled={savingId === (superAdminPromotionTarget._id || superAdminPromotionTarget.id)} className={`rounded-lg border px-4 py-2.5 text-sm font-semibold ${darkMode ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>Cancel</button>
                <button type="button" onClick={promoteStaffAccountToSuperAdmin} disabled={!superAdminPromotionPassword || activeSuperAdminCount >= 2 || savingId === (superAdminPromotionTarget._id || superAdminPromotionTarget.id)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">{savingId === (superAdminPromotionTarget._id || superAdminPromotionTarget.id) && <Loader2 size={15} className="animate-spin" />}{savingId === (superAdminPromotionTarget._id || superAdminPromotionTarget.id) ? "Promoting..." : "Confirm Promotion"}</button>
              </div>
            </section>
          </div>}
          {superAdminDemotionTarget && <div className="fixed inset-0 z-[155] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && savingId !== (superAdminDemotionTarget._id || superAdminDemotionTarget.id)) { setSuperAdminDemotionTarget(null); setSuperAdminDemotionPassword(""); setShowSuperAdminDemotionPassword(false); } }}>
            <section role="alertdialog" aria-modal="true" aria-labelledby="demote-super-admin-title" aria-describedby="demote-super-admin-description" className={`w-full max-w-lg rounded-2xl border p-6 shadow-2xl ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
              <h2 id="demote-super-admin-title" className={`text-lg font-bold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Convert Super Admin to Staff?</h2>
              <p id="demote-super-admin-description" className={`mt-3 text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>You are converting <strong>{`${superAdminDemotionTarget.first_name || "Super Admin"} ${superAdminDemotionTarget.last_name || ""}`.trim()}</strong> from Super Admin to Staff. Their staff type, account history, and existing records will be preserved. The primary Super Admin will remain active.</p>
              <label className={`mt-5 grid gap-1.5 text-sm font-medium ${darkMode ? "text-slate-300" : "text-slate-700"}`}>Your current password
                <span className="relative block">
                  <input type={showSuperAdminDemotionPassword ? "text" : "password"} name="super-admin-demotion-confirmation" autoComplete="new-password" value={superAdminDemotionPassword} onChange={(event) => setSuperAdminDemotionPassword(event.target.value)} disabled={savingId === (superAdminDemotionTarget._id || superAdminDemotionTarget.id)} className={`h-10 w-full rounded-lg border px-3 pr-11 text-sm outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`} />
                  <button type="button" onClick={() => setShowSuperAdminDemotionPassword((visible) => !visible)} disabled={savingId === (superAdminDemotionTarget._id || superAdminDemotionTarget.id)} aria-label={showSuperAdminDemotionPassword ? "Hide current password" : "Show current password"} aria-pressed={showSuperAdminDemotionPassword} className={`absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center ${darkMode ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-800"}`}>
                    {showSuperAdminDemotionPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                  </button>
                </span>
              </label>
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => { setSuperAdminDemotionTarget(null); setSuperAdminDemotionPassword(""); setShowSuperAdminDemotionPassword(false); }} disabled={savingId === (superAdminDemotionTarget._id || superAdminDemotionTarget.id)} className={`rounded-lg border px-4 py-2.5 text-sm font-semibold ${darkMode ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>Cancel</button>
                <button type="button" onClick={convertSecondarySuperAdminToStaff} disabled={!superAdminDemotionPassword || savingId === (superAdminDemotionTarget._id || superAdminDemotionTarget.id)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">{savingId === (superAdminDemotionTarget._id || superAdminDemotionTarget.id) && <Loader2 size={15} className="animate-spin" />}{savingId === (superAdminDemotionTarget._id || superAdminDemotionTarget.id) ? "Converting..." : "Confirm Conversion"}</button>
              </div>
            </section>
          </div>}
          {restoreConfirmation && <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (!restoringBackup && event.target === event.currentTarget) {
                setRestoreRecoveryPassword("");
                setRestoreConfirmation(null);
              }
            }}
          >
            <section
              ref={restoreDialogRef}
              role="alertdialog"
              aria-modal="true"
              tabIndex={-1}
              aria-labelledby="restore-confirm-title"
              aria-describedby="restore-confirm-description"
              className={`w-full max-w-md rounded-xl border p-6 shadow-2xl ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}
            >
              <div className="flex items-start gap-3">
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${darkMode ? "bg-amber-950/60 text-amber-300" : "bg-amber-100 text-amber-800"}`}>
                  <RotateCcw aria-hidden="true" className="size-5" />
                </span>
                <div className="min-w-0">
                  <h2 id="restore-confirm-title" className={`text-lg font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>
                    {uploadedBackup?.id === restoreConfirmation.id ? "Sync uploaded backup?" : "Restore backup?"}
                  </h2>
                  <p className={`mt-1 break-words text-sm font-medium ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{restoreConfirmation.name}</p>
                </div>
              </div>
              <p id="restore-confirm-description" className={`mt-4 text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                This will replace the current database records and uploaded files with the contents of this backup. This action cannot be undone from the system after it completes.
              </p>
              <label className={`mt-4 grid gap-1.5 text-xs font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Recovery password<input type="password" autoComplete="new-password" data-1p-ignore="true" data-lpignore="true" data-form-type="other" value={restoreRecoveryPassword} onChange={(event) => setRestoreRecoveryPassword(event.target.value)} disabled={restoringBackup} required minLength={12} maxLength={128} className={`h-10 rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand ${darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`} /></label>
              <p className={`mt-2 text-xs leading-relaxed ${darkMode ? "text-slate-400" : "text-slate-500"}`}>The pre-restore snapshot is created automatically. Users will be signed out after a successful restore.</p>
              <footer className={`mt-6 flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                <button
                  type="button"
                  onClick={() => {
                    setRestoreRecoveryPassword("");
                    setRestoreConfirmation(null);
                  }}
                  disabled={restoringBackup}
                  className={`rounded-md border px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${darkMode ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmRestoreBackup}
                  disabled={restoringBackup || restoreRecoveryPassword.length < 12}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-red-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {restoringBackup && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
                  {restoringBackup
                    ? uploadedBackup?.id === restoreConfirmation.id ? "Syncing..." : "Restoring..."
                    : uploadedBackup?.id === restoreConfirmation.id ? "Sync Backup" : "Restore Backup"}
                </button>
              </footer>
            </section>
          </div>}
          {deleteConfirmation && <div
            className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (!deletingBackup && event.target === event.currentTarget) setDeleteConfirmation(null);
            }}
          >
            <section
              ref={deleteDialogRef}
              role="alertdialog"
              aria-modal="true"
              tabIndex={-1}
              aria-labelledby="delete-backup-title"
              aria-describedby="delete-backup-description"
              className={`w-full max-w-md rounded-xl border p-6 shadow-2xl ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}
            >
              <div className="flex items-start gap-3">
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${darkMode ? "bg-red-950/60 text-red-300" : "bg-red-100 text-red-800"}`}>
                  <Trash2 aria-hidden="true" className="size-5" />
                </span>
                <div className="min-w-0">
                  <h2 id="delete-backup-title" className={`text-lg font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Delete backup?</h2>
                  <p className={`mt-1 break-words text-sm font-medium ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{deleteConfirmation.name}</p>
                </div>
              </div>
              <p id="delete-backup-description" className={`mt-4 text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                This backup file will be permanently deleted and can no longer be restored.
              </p>
              <footer className={`mt-6 flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                <button
                  type="button"
                  onClick={() => setDeleteConfirmation(null)}
                  disabled={deletingBackup}
                  className={`rounded-md border px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${darkMode ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
                >
                  Keep Backup
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteBackup}
                  disabled={deletingBackup}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deletingBackup && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
                  {deletingBackup ? "Deleting..." : "Delete Backup"}
                </button>
              </footer>
            </section>
          </div>}
          {showScheduleTimeModal && <div
            className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setShowScheduleTimeModal(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setShowScheduleTimeModal(false);
            }}
          >
            <section role="dialog" aria-modal="true" aria-labelledby="backup-time-title" className={`w-full max-w-sm rounded-xl border p-6 shadow-2xl ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
              <h2 id="backup-time-title" className={`text-lg font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Scheduled backup time</h2>
              <p className={`mt-1 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Choose a time in Asia/Manila.</p>
              <label htmlFor="backup-schedule-time" className={`mt-5 block text-sm font-medium ${darkMode ? "text-slate-200" : "text-slate-700"}`}>Time</label>
              <input id="backup-schedule-time" type="time" autoFocus value={scheduleTimeDraft} onChange={(event) => setScheduleTimeDraft(event.target.value)} className={`mt-1.5 h-11 w-full rounded-lg border px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-brand ${darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`} />
              <footer className={`mt-6 flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                <button type="button" onClick={() => setShowScheduleTimeModal(false)} className={`rounded-md border px-4 py-2.5 text-sm font-medium ${darkMode ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>Cancel</button>
                <button type="button" onClick={handleScheduleTimeSave} className="rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90">Save time</button>
              </footer>
            </section>
          </div>}
        </main>
      </div>
    </div>
  );
}

function PermissionSwitch({ permission, index = 0, checked, onChange, disabled = false, compact = false, tableMode = false, darkMode = false }) {
  if (tableMode) {
    return <button type="button" role="switch" aria-label={permission.label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={`relative inline-flex h-7 w-12 rounded-full border-0 p-0 shadow-inner transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 ${checked ? "bg-sky-700" : (darkMode ? "bg-slate-600" : "bg-slate-300")}`}><span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-[0_1px_4px_rgba(15,23,42,0.28)] transition-transform duration-200 ease-out ${checked ? "translate-x-5" : "translate-x-0"}`} /></button>;
  }

  return <label className={`group flex min-h-[74px] cursor-pointer items-center justify-between gap-3 rounded-2xl border px-3 py-3 transition-all sm:gap-4 sm:px-4 sm:py-3.5 ${checked ? (darkMode ? "border-sky-700/70 bg-sky-950/25 shadow-[inset_3px_0_0_#67a7c7]" : "border-sky-200 bg-sky-50/80 shadow-[inset_3px_0_0_#2f6f91]") : (darkMode ? "border-slate-700 bg-slate-800/60 hover:border-slate-600" : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm")} ${disabled ? "cursor-wait opacity-60" : ""}`}><span className="flex min-w-0 items-center gap-3"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-black ${checked ? (darkMode ? "bg-sky-900/70 text-sky-200" : "bg-sky-100 text-sky-800") : (darkMode ? "bg-slate-700 text-slate-400" : "bg-slate-100 text-slate-500")}`}>{String(index + 1).padStart(2, "0")}</span><span className="min-w-0"><span className={`block text-xs font-bold ${checked ? (darkMode ? "text-sky-100" : "text-slate-900") : (darkMode ? "text-slate-300" : "text-slate-700")}`}>{permission.label}</span>{!compact && <span className={`mt-1 block line-clamp-2 break-words text-[10px] ${darkMode ? "text-slate-500" : "text-slate-500"}`}>{permission.description}</span>}{!compact && <span className={`mt-1 block text-[9px] font-bold uppercase tracking-wider ${checked ? (darkMode ? "text-sky-300" : "text-sky-700") : (darkMode ? "text-slate-600" : "text-slate-400")}`}>{checked ? "Available" : "Restricted"}</span>}</span></span><button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={`relative h-7 w-12 shrink-0 rounded-full border-0 p-0 shadow-inner transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 ${checked ? "bg-sky-700" : (darkMode ? "bg-slate-600" : "bg-slate-300")}`}><span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-[0_1px_4px_rgba(15,23,42,0.28)] transition-transform duration-200 ease-out ${checked ? "translate-x-5" : "translate-x-0"}`} /></button></label>;
}

export default Settings;
