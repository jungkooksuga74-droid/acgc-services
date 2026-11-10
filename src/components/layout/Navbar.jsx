import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import logo from "../../assets/images/ACGCLOGO1.png";
import { Bell, Moon, Sun, ClipboardCheck, CheckCircle2, XCircle, ShoppingCart, CheckCheck, CreditCard, Send, LogOut, X, Wrench, UserCog } from "lucide-react";
import { getAdminOrders } from "@/api/orders";
import { getRepairRequests } from "@/api/repairs";
import { subscribeToRealtime } from "@/lib/realtimeEvents";
import { formatDateTimeToMMDDYYYY, formatTimeAgo } from "@/lib/dateUtils";
import { ADMIN_READ_NOTIFICATIONS_KEY, getAdminNotificationId, getAdminReadNotificationIds, markAdminNotificationRead, markAdminNotificationsRead, sortAdminNotificationsNewestFirst } from "@/lib/notificationState";
import { useAdminTheme } from "@/contexts/AdminThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { getAdminSiteInspectionNotificationMessage } from "@/pages/CustomerDashboard/orderStatusUtils";

function Navbar() {
  const { darkMode, toggleDarkMode } = useAdminTheme();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const canOpenProfile = user?.role !== "skilled_worker" || (
    user?.staff_access?.modules?.profile?.enabled === true
    && user?.staff_access?.modules?.profile?.actions?.view === true
  );
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  return (
    <>
      <header className={`admin-navbar flex w-full min-w-0 items-center justify-between gap-1 px-2 py-2 shadow sm:gap-2 sm:px-6 sm:py-4 ${darkMode ? "bg-slate-900 text-white" : "bg-white text-slate-900"}`}>

        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
          <div className="flex min-w-0 items-center gap-2 sm:hidden">
            <img src={logo} alt="ACGC Aluminum Services" className="h-9 w-9 shrink-0 object-contain drop-shadow-[0_0_5px_rgba(255,255,255,0.9)]" />
            <div className="min-w-0">
              <p className="whitespace-nowrap text-sm font-bold leading-tight text-[#ff3038]">ACGC Services</p>
              <p className={`whitespace-nowrap text-[9px] font-semibold leading-tight ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Aluminum &amp; Glass Services</p>
            </div>
          </div>
          <div className="hidden sm:block">
            <h1 className="text-xl font-bold">
              {user?.role === "skilled_worker" ? "Welcome Staff" : "Welcome Administrator"}
            </h1>
          </div>

        </div>

        <div className="relative flex shrink-0 items-center gap-1 sm:gap-3">
          <button
            type="button"
            onClick={toggleDarkMode}
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition focus:outline-none sm:h-10 sm:w-10 ${
              darkMode ? "text-slate-200 hover:bg-slate-800" : "text-slate-700 hover:bg-slate-100"
            }`}
            aria-label={darkMode ? "Switch to day mode" : "Switch to night mode"}
            aria-pressed={darkMode}
            title={darkMode ? "Switch to day mode" : "Switch to night mode"}
          >
            {darkMode
              ? <Moon size={22} strokeWidth={1.8} className="text-sky-300" />
              : <Sun size={22} strokeWidth={1.8} className="text-amber-500" />}
          </button>

          <div className="flex items-center gap-1 sm:gap-2">
            <NotificationMenu />
            {canOpenProfile && <button
              type="button"
              onClick={() => navigate("/profile")}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-xl border transition sm:hidden ${darkMode ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-slate-100"}`}
              aria-label="Open profile"
              title="Profile"
            >
              <UserCog size={18} aria-hidden="true" />
            </button>}
            <button
              type="button"
              onClick={() => setLogoutConfirmOpen(true)}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-xl border transition sm:h-10 sm:w-10 ${darkMode ? "border-red-500/40 text-red-300 hover:bg-red-500/10" : "border-red-200 text-red-700 hover:bg-red-50"}`}
              aria-label="Log out"
              title="Log out"
            >
              <LogOut size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

      </header>

      {logoutConfirmOpen && (
        <div className="fixed inset-0 z-[100] flex min-h-screen items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/45 backdrop-blur-md"
            onClick={() => setLogoutConfirmOpen(false)}
          />
          <div className={`relative z-40 w-full max-w-sm rounded-2xl p-6 text-center shadow-2xl ${darkMode ? "bg-slate-800 text-white" : "bg-white text-slate-900"}`}>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
              <LogOut size={22} />
            </div>
            <h3 className="mt-4 text-lg font-semibold">Confirm Logout</h3>
            <p className={`mt-2 text-sm ${darkMode ? "text-slate-300" : "text-gray-600"}`}>
              Are you sure you want to log out?
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <button
                onClick={() => setLogoutConfirmOpen(false)}
                className={`rounded-lg px-3 py-1 ${darkMode ? "bg-slate-700 text-slate-100 hover:bg-slate-600" : "bg-gray-100 hover:bg-gray-200"}`}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setLogoutConfirmOpen(false);
                  logout();
                }}
                className="rounded-lg bg-red-600 px-3 py-1 text-white hover:bg-red-700"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Navbar;

const adminNotificationCache = {
  ownerId: "",
  items: [],
  initialized: false,
};

function NotificationMenu() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const ownerId = String(user?._id || user?.id || "");
  const [notifications, setNotifications] = useState(() => (
    adminNotificationCache.ownerId === ownerId ? adminNotificationCache.items : []
  ));
  const [loading, setLoading] = useState(() => (
    adminNotificationCache.ownerId !== ownerId || !adminNotificationCache.initialized
  ));
  const [notificationFilter, setNotificationFilter] = useState("all");
  const { darkMode } = useAdminTheme();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    let requestInFlight = false;
    let refreshQueued = false;
    if (adminNotificationCache.ownerId !== ownerId) {
      adminNotificationCache.ownerId = ownerId;
      adminNotificationCache.items = [];
      adminNotificationCache.initialized = false;
    }
    const staffModules = user?.staff_access?.modules || {};
    const canReadModule = (moduleKey) => user?.role !== "skilled_worker" || (
      staffModules[moduleKey]?.enabled === true && staffModules[moduleKey]?.actions?.view === true
    );
    const fetchModuleOrders = (params, moduleKey) => canReadModule(moduleKey)
      ? getAdminOrders({ ...params, module: moduleKey, view: "notifications", limit: 100 })
      : Promise.resolve({ orders: [] });

    const fetchNotifications = async () => {
      if (!active) return;
      if (requestInFlight) {
        refreshQueued = true;
        return;
      }
      requestInFlight = true;
      const showInitialLoading = !adminNotificationCache.initialized;
      if (showInitialLoading) setLoading(true);
      try {
        const [newOrders, inspections, accepted, declined, sentContracts, paymentSubmissions, cancelledOrders, repairRequests] = await Promise.all([
          fetchModuleOrders({ status: "order_submitted" }, "dashboard"),
          fetchModuleOrders({ status: "site_inspection" }, "site_inspection"),
          fetchModuleOrders({ contract_status: "accepted" }, "site_inspection"),
          fetchModuleOrders({ contract_status: "declined" }, "site_inspection"),
          fetchModuleOrders({ contract_status: "sent" }, "site_inspection"),
          fetchModuleOrders({ payment_proof_submitted: "true" }, "transactions"),
          fetchModuleOrders({ status: "cancelled" }, "site_inspection"),
          user?.role === "skilled_worker" ? Promise.resolve({ repairs: [] }) : getRepairRequests(),
        ]);
        const isLegacyUnscheduledOnlineOrder = (order) => (
          String(order.order_type || "").toLowerCase() === "online_order"
          && !order.inspection_date
          && !["scheduled", "completed"].includes(String(order.inspection_status || "pending").toLowerCase())
        );
        const legacyUnscheduledOrders = (inspections.orders || []).filter(isLegacyUnscheduledOnlineOrder);

        const readNotificationIds = getAdminReadNotificationIds();
        const items = [
          ...(newOrders.orders || []).map((order) => ({
            id: getAdminNotificationId("new-order", order),
            recordId: String(order._id || order.id || order.tracking),
            tracking: order.tracking || order.order_number || order.orderNumber || "Not assigned",
            title: "New order request",
            message: `${order.tracking || "An order"} is waiting for approval.`,
            icon: ShoppingCart,
            color: "text-blue-600",
            category: "orders",
            path: "/dashboard",
            date: order.createdAt,
          })),
          ...(cancelledOrders.orders || []).map((order) => {
            const customerName = `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim()
              || order.customer_name
              || "Customer";
            const orderNumber = order.tracking || order.order_number || order.orderNumber || "this order";
            const cancellationReason = String(order.cancellation_reason || "").trim();
            return {
              id: getAdminNotificationId("cancelled", order),
              recordId: String(order._id || order.id || order.tracking),
              tracking: order.tracking || order.order_number || order.orderNumber || "Not assigned",
              title: "Order cancelled",
              message: `${customerName}'s order ${orderNumber} was cancelled.${cancellationReason ? ` Reason: ${cancellationReason}` : ""}`,
              icon: XCircle,
              color: "text-red-600",
              category: "orders",
              path: "/site-inspection",
              notificationType: "cancelled",
              date: order.updatedAt || order.createdAt,
            };
          }),
          ...legacyUnscheduledOrders.map((order) => ({
            id: getAdminNotificationId("pending-inspection-order", order),
            recordId: String(order._id || order.id || order.tracking),
            tracking: order.tracking || order.order_number || order.orderNumber || "Not assigned",
            title: "Order awaiting inspection scheduling",
            message: `${order.tracking || "An order"} is waiting for an inspection to be scheduled.`,
            icon: ShoppingCart,
            color: "text-blue-600",
            category: "orders",
            path: "/site-inspection",
            notificationType: "pending-inspection-order",
            date: order.updatedAt || order.createdAt,
          })),
          ...(inspections.orders || [])
            .filter((order) => (
              !["sent", "declined"].includes(String(order.contract_status || "").toLowerCase())
              && !isLegacyUnscheduledOnlineOrder(order)
            ))
            .map((order) => {
              const customerName = `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim() || order.customer_name || "Customer";
              const inspectionMessage = getAdminSiteInspectionNotificationMessage(order, customerName);
              return {
                id: getAdminNotificationId("inspection", order),
                recordId: String(order._id || order.id || order.tracking),
                tracking: order.tracking || order.order_number || order.orderNumber || "Not assigned",
                title: order.inspection_date || order.inspection_status === "scheduled" ? "Inspection scheduled" : "Inspection needs scheduling",
                message: inspectionMessage,
                icon: ClipboardCheck,
                color: "text-amber-600",
                category: "inspections",
                path: "/site-inspection",
                date: order.updatedAt || order.createdAt,
              };
            }),
          ...(accepted.orders || []).map((order) => ({
            id: getAdminNotificationId("accepted", order),
            recordId: String(order._id || order.id || order.tracking),
            tracking: order.tracking || order.order_number || order.orderNumber || "Not assigned",
            title: "Contract accepted",
            message: `Customer accepted ${order.tracking || "a contract"}.`,
            icon: CheckCircle2,
            color: "text-emerald-600",
            category: "accepted",
            path: `/site-inspection?view=${order._id || order.id || order.tracking}`,
            date: order.updatedAt || order.createdAt,
          })),
          ...(declined.orders || []).map((order) => ({
            id: getAdminNotificationId("declined", order),
            recordId: String(order._id || order.id || order.tracking),
            tracking: order.tracking || order.order_number || order.orderNumber || "Not assigned",
            title: "Contract declined",
            message: `Customer declined ${order.tracking || "a contract"}.`,
            icon: XCircle,
            color: "text-red-600",
            category: "declined",
            path: `/site-inspection?view=${order._id || order.id || order.tracking}`,
            date: order.updatedAt || order.createdAt,
          })),
          ...(sentContracts.orders || []).map((order) => ({
            id: getAdminNotificationId("sent", order),
            recordId: String(order._id || order.id || order.tracking),
            tracking: order.tracking || order.order_number || order.orderNumber || "Not assigned",
            title: "Contract sent",
            message: `Contract for ${order.tracking || "a project"} was sent to the customer.`,
            icon: Send,
            color: "text-sky-600",
            category: "sent",
            path: `/site-inspection?view=${order._id || order.id || order.tracking}`,
            date: order.contractSentAt || order.updatedAt || order.createdAt,
          })),
          ...(paymentSubmissions.orders || []).map((order) => {
            const customerName = `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim()
              || order.customer_name
              || "Customer";
            const orderNumber = order.tracking || order.order_number || order.orderNumber || order._id;
            const amount = Number(order.payment_proof_amount || order.payment_amount || 0)
              .toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            return {
              id: getAdminNotificationId("payment", order),
              recordId: String(order._id || order.id || order.tracking),
              tracking: order.tracking || order.order_number || order.orderNumber || "Not assigned",
              title: "Customer Reported a Payment",
              message: `${customerName} says they paid ₱${amount} for order ${orderNumber}. Please confirm.`,
              icon: CreditCard,
              color: "text-emerald-600",
              category: "payments",
              path: "/transactions",
              date: order.payment_proof_submitted_at,
            };
          }),
          ...(repairRequests.repairs || []).flatMap((repair) => {
            const titles = {
              pending_review: "New repair request",
              admin_approved: "Warranty claim approved",
              rejected: "Warranty claim rejected",
              quotation_issued: "Repair quotation issued",
              customer_accepted: "Customer accepted quotation",
              quotation_declined: "Customer declined quotation",
              payment_proof_submitted: "Repair payment proof submitted",
              payment_proof_approved: "Repair payment verified",
              payment_proof_rejected: "Repair payment proof rejected",
              payment_verified: "Repair payment verified",
              receipt_issued: "Repair receipt issued",
              cancelled: "Repair quotation declined",
              scheduled: "Repair visit scheduled",
              in_progress: "Repair work started",
              completed: "Repair completed",
            };
            const history = repair.history?.length ? repair.history : [{ event: repair.status || "pending_review", detail: "Repair request updated.", createdAt: repair.updatedAt || repair.createdAt }];
            return history.map((entry, index) => ({
              id: `repair-${repair._id}-${entry.event}-${entry.createdAt ? new Date(entry.createdAt).getTime() : index}-${index}`,
              recordId: String(repair._id),
              tracking: repair.orderTracking || "Repair request",
              title: titles[entry.event] || "Repair request updated",
              message: entry.detail || `${repair.productName || "Product repair"} status updated to ${String(repair.status || "updated").replaceAll("_", " ")}.`,
              icon: Wrench,
              color: entry.event === "completed" || entry.event === "admin_approved" ? "text-emerald-600" : entry.event === "cancelled" || entry.event === "rejected" ? "text-red-600" : "text-amber-600",
              category: "repairs",
              path: "/progress-monitor",
              notificationType: "repair-request",
              date: entry.createdAt || repair.updatedAt || repair.createdAt,
            }));
          }),
        ]
          .sort(sortAdminNotificationsNewestFirst)
          .map((item) => ({ ...item, read: readNotificationIds.has(item.id) }));

        adminNotificationCache.ownerId = ownerId;
        adminNotificationCache.items = items;
        adminNotificationCache.initialized = true;
        if (active) setNotifications(items);
      } catch (error) {
        console.error("Failed to load admin notifications:", error);
        if (active && !adminNotificationCache.initialized) setNotifications([]);
      } finally {
        requestInFlight = false;
        if (active) setLoading(false);
        if (active && refreshQueued) {
          refreshQueued = false;
          scheduleRefresh();
        }
      }
    };

    fetchNotifications();
    let refreshTimeout = null;
    const scheduleRefresh = () => {
      if (refreshTimeout) window.clearTimeout(refreshTimeout);
      refreshTimeout = window.setTimeout(() => {
        refreshTimeout = null;
        if (document.visibilityState === "visible") fetchNotifications();
      }, 80);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };
    const refreshReadState = (event) => {
      if (event.key === ADMIN_READ_NOTIFICATIONS_KEY) scheduleRefresh();
    };
    const unsubscribeRealtime = subscribeToRealtime(["orders", "reviews", "repairs"], scheduleRefresh);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("storage", refreshReadState);
    window.addEventListener("admin-notifications-updated", scheduleRefresh);
    return () => {
      active = false;
      if (refreshTimeout) window.clearTimeout(refreshTimeout);
      unsubscribeRealtime();
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("storage", refreshReadState);
      window.removeEventListener("admin-notifications-updated", scheduleRefresh);
    };
  }, [user, ownerId]);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const filteredNotifications = notifications.filter((notification) => (
    notificationFilter === "all" || notification.category === notificationFilter
  ));
  const visibleNotifications = filteredNotifications.slice(0, 8);
  const adminFilterOptions = [
    ["all", "All"],
    ["orders", "Orders"],
    ["inspections", "Inspections"],
    ["accepted", "Accepted"],
    ["declined", "Declined"],
    ["sent", "Sent"],
    ["payments", "Payments"],
    ["repairs", "Repairs"],
  ];

  const openNotification = (notification) => {
    setNotifications((current) => current.map((item) => (
      item.id === notification.id ? { ...item, read: true } : item
    )));
    markAdminNotificationRead(notification.id);
    setOpen(false);
    navigate(notification.path, {
      state: {
        ...(notification.notificationType === "repair-request" ? { statusFilter: "Product Repair" } : {}),
        ...(notification.notificationType === "cancelled" ? { activeTab: "cancelled" } : {}),
        ...(notification.notificationType === "sent" || notification.category === "sent" ? { openContract: true } : {}),
        notificationHighlight: {
          recordId: notification.recordId,
          recordType: notification.notificationType === "repair-request"
            ? "repair"
            : notification.notificationType === "pending-inspection-order" || notification.notificationType === "cancelled"
            ? "inspection"
            : notification.category === "payments"
            ? "payment"
            : notification.category === "inspections"
              ? "inspection"
              : ["accepted", "declined", "sent"].includes(notification.category)
                ? "contract"
                : "order",
        },
      },
    });
  };

  const markAllNotificationsRead = () => {
    setNotifications((current) => current.map((item) => ({ ...item, read: true })));
    markAdminNotificationsRead(notifications.map((notification) => notification.id));
  };

  return (
    <div className="relative">
        <button
        onClick={() => setOpen((s) => !s)}
        className={`relative inline-flex h-9 w-9 items-center justify-center rounded-xl transition ${open || unreadCount > 0 ? (darkMode ? "bg-red-950/60 text-red-300 ring-1 ring-red-400/60" : "bg-red-50 text-red-600 ring-1 ring-red-200") : (darkMode ? "text-slate-200 hover:bg-slate-800" : "text-slate-700 hover:bg-gray-100")}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Notifications"
        title="Notifications"
      >
        <Bell size={23} strokeWidth={2.2} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white shadow-md shadow-red-500/40">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className={`fixed inset-x-0 bottom-0 top-[calc(3.5rem+env(safe-area-inset-top))] z-[70] m-0 flex h-auto max-h-none w-screen max-w-none flex-col overflow-hidden border-0 pb-[env(safe-area-inset-bottom)] shadow-none lg:inset-auto lg:right-1 lg:top-[4.25rem] lg:z-20 lg:mt-0 lg:h-auto lg:max-h-[min(36rem,calc(100vh-6rem))] lg:w-96 lg:max-w-md lg:rounded-2xl lg:border lg:p-0 lg:shadow-2xl ${darkMode ? "bg-slate-800 border-slate-700" : "bg-white border-slate-200"}`}>
          <div className={`flex shrink-0 items-center justify-between border-b px-3 py-2.5 sm:px-4 sm:py-3 ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
            <div>
              <p className={`text-sm font-bold ${darkMode ? "text-white" : "text-slate-950"}`}>Admin activity</p>
              <p className="mt-0.5 text-[11px] text-slate-400 sm:text-xs">Actions that need your attention</p>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              {unreadCount > 0 && <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-red-600 sm:px-2 sm:py-1 sm:text-[10px]">{unreadCount} new</span>}
              <button
                type="button"
                onClick={markAllNotificationsRead}
                disabled={unreadCount === 0}
                className={`inline-flex items-center gap-1 text-[10px] font-semibold transition sm:text-xs ${unreadCount === 0 ? "cursor-not-allowed text-slate-400" : darkMode ? "text-red-300 hover:text-white" : "text-red-600 hover:text-red-700"}`}
              >
                <CheckCheck size={12} className="sm:h-[14px] sm:w-[14px]" />
                Mark all as read
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors lg:hidden ${darkMode ? "text-slate-300 hover:bg-slate-700" : "text-slate-600 hover:bg-slate-100"}`}
                aria-label="Close notifications"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className={`flex shrink-0 flex-wrap gap-1 border-b px-2 py-1.5 sm:px-3 sm:py-2 ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
            {adminFilterOptions.map(([filter, label]) => {
              const count = filter === "all"
                ? notifications.length
                : notifications.filter((notification) => notification.category === filter).length;

              return (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setNotificationFilter(filter)}
                  className={`rounded-lg px-2 py-1 text-[10px] font-semibold transition sm:px-2.5 sm:py-1.5 sm:text-xs ${
                    notificationFilter === filter
                      ? darkMode
                        ? "bg-slate-950 text-white"
                        : "bg-slate-100 text-slate-950"
                      : darkMode
                        ? "text-slate-300 hover:bg-slate-700"
                        : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {label} ({count})
                </button>
              );
            })}
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {loading ? (
              <div className="space-y-2 px-3 py-3 sm:px-4" aria-label="Loading notifications">
                {[0, 1].map((row) => (
                  <div key={row} className={`h-14 animate-pulse rounded-lg ${darkMode ? "bg-slate-700/70" : "bg-slate-100"}`} />
                ))}
              </div>
            ) : filteredNotifications.length === 0 ? (
              <div className={`px-3 py-5 text-center sm:px-4 sm:py-6 ${darkMode ? "text-slate-300" : "text-gray-600"}`}>
                <Bell size={18} className="mx-auto mb-2 text-slate-400 sm:h-[22px] sm:w-[22px]" />
                <p>{notificationFilter === "all" ? "No action items right now" : `No ${notificationFilter} notifications`}</p>
              </div>
            ) : (
              <div className="min-h-0 flex-1 divide-y overflow-y-auto overscroll-contain pb-20 lg:pb-0">
                {visibleNotifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => openNotification(n)}
                    className={`group w-full border-l-2 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500 sm:px-4 sm:py-3 ${
                      n.read
                        ? darkMode ? "border-transparent bg-slate-800/60 hover:bg-slate-800" : "border-transparent bg-white hover:bg-slate-50"
                        : darkMode ? "border-sky-400/70 bg-slate-800/90 hover:bg-slate-800" : "border-sky-400/70 bg-sky-50/40 hover:bg-sky-50/70"
                    }`}
                  >
                    <div className="flex gap-2.5 sm:gap-3">
                      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl ring-1 sm:h-9 sm:w-9 ${darkMode ? "bg-slate-700 ring-white/5" : "bg-slate-100 ring-slate-200/70"}`}>
                        <n.icon size={15} className={n.color} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className={`truncate text-xs sm:text-sm ${n.read ? "font-medium" : "font-bold"} ${darkMode ? n.read ? "text-slate-300" : "text-white" : n.read ? "text-slate-600" : "text-slate-950"}`}>{n.title}</p>
                          {!n.read && <span className="shrink-0 rounded-full bg-sky-100 px-1.5 py-0.5 text-[8px] font-bold uppercase text-sky-700 sm:text-[9px]">New</span>}
                        </div>
                        <p className={`mt-0.5 text-[11px] leading-4 sm:text-xs ${darkMode ? n.read ? "text-slate-400" : "text-slate-300" : n.read ? "text-slate-500" : "text-slate-700"}`}>{n.message}</p>
                        <p className={`mt-1 text-[10px] font-medium sm:text-[11px] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Tracking ID: {n.tracking}</p>
                        <p className="mt-1 text-[10px] text-slate-400 sm:text-xs" title={n.date ? formatDateTimeToMMDDYYYY(n.date) : undefined}>
                          {formatTimeAgo(n.date)}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => { setOpen(false); navigate("/notifications", { state: { from: location.pathname } }); }}
            className={`sticky bottom-0 z-10 w-full shrink-0 border-t px-3 py-2.5 text-center text-sm font-semibold transition-colors sm:px-4 sm:py-3 ${darkMode ? "border-slate-700 bg-slate-800 text-red-300 hover:bg-slate-700" : "border-slate-100 bg-white text-red-600 hover:bg-red-50"}`}
          >
            View all notifications
          </button>
        </div>
      )}
    </div>
  );
}
