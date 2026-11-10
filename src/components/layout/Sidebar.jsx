import { startTransition, useContext, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import logo from "../../assets/images/ACGCLOGO1.png";
import { useAuth } from "../../contexts/AuthContext";

import {
  Gauge,
  ClipboardCheck,
  ReceiptText,
  ChartNoAxesCombined,
  Package,
  UserCog,
  Settings,
  LogOut,
  Pin,
  Wrench,
} from "lucide-react";

import { useAdminTheme } from "@/contexts/AdminThemeContext";
import AdminNavigationContext from "@/contexts/AdminNavigationContext";
import { prefetchAdminRoute } from "@/lib/adminRoutePrefetch";
import { getAdminOrders } from "@/api/orders";
import { getRepairRequests } from "@/api/repairs";
import { subscribeToRealtime } from "@/lib/realtimeEvents";
import { getAdminNotificationId, getAdminReadNotificationIds, markAdminNotificationsRead, ADMIN_READ_NOTIFICATIONS_KEY } from "@/lib/notificationState";

const handleSpaNavigation = (event, to, navigate) => {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    (event.currentTarget.getAttribute("target") && event.currentTarget.getAttribute("target") !== "_self")
  ) return;

  event.preventDefault();
  startTransition(() => navigate(to));
};

function Sidebar({ forceRender = false }) {
  const [isHovered, setIsHovered] = useState(false);
  const [pinMode, setPinMode] = useState(null);
  const hoverOpenTimerRef = useRef(null);
  const isOpen = pinMode === "open" || (pinMode !== "collapsed" && isHovered);
  const handleSidebarMouseEnter = (event) => {
    if (pinMode === "collapsed" || event.target.closest("[data-sidebar-pin]")) return;
    window.clearTimeout(hoverOpenTimerRef.current);
    hoverOpenTimerRef.current = window.setTimeout(() => setIsHovered(true), 150);
  };
  const cancelSidebarHoverOpen = () => window.clearTimeout(hoverOpenTimerRef.current);
  const toggleSidebarPin = () => {
    if (pinMode) {
      setPinMode(null);
      return;
    }
    setPinMode(isHovered ? "open" : "collapsed");
  };
  const isProvidedByAppShell = useContext(AdminNavigationContext);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const { darkMode } = useAdminTheme();
  const [badges, setBadges] = useState({ dashboard: 0, siteInspection: 0, transactions: 0, progressMonitor: 0, repairManagement: 0 });
  const canViewStaffModule = (moduleKey) => user?.role !== "skilled_worker" || (
    user.staff_access?.modules?.[moduleKey]?.enabled === true &&
    user.staff_access?.modules?.[moduleKey]?.actions?.view === true
  );

  useEffect(() => {
    let active = true;
    let timeout;
    const refresh = async (markVisitedPageRead = false) => {
      const modules = user?.staff_access?.modules || {};
      const canRead = (key) => user?.role !== "skilled_worker" || (modules[key]?.enabled === true && modules[key]?.actions?.view === true);
      const fetchOrders = async (params, key, view = "notifications") => {
        if (!canRead(key)) return [];
        const allOrders = [];
        let page = 1;
        let totalPages = 1;
        do {
          const response = await getAdminOrders({ ...params, module: key, view, limit: 100, ...(page > 1 ? { page } : {}) });
          allOrders.push(...(response.orders || []));
          totalPages = response.pagination?.totalPages || 1;
          page += 1;
        } while (page <= totalPages);
        return allOrders;
      };
      try {
        const [newOrders, inspections, accepted, declined, sent, payments, progressOrders, repairs] = await Promise.all([
          fetchOrders({ status: "order_submitted" }, "dashboard"),
          fetchOrders({ status: "site_inspection" }, "site_inspection"),
          fetchOrders({ contract_status: "accepted" }, "site_inspection"),
          fetchOrders({ contract_status: "declined" }, "site_inspection"),
          fetchOrders({ contract_status: "sent" }, "site_inspection"),
          fetchOrders({ payment_proof_submitted: "true" }, "transactions"),
          fetchOrders({}, "progress_monitoring", "progress_monitoring"),
          canRead("repair_management")
            ? getRepairRequests().then((response) => response.repairs || [])
            : Promise.resolve([]),
        ]);
        const read = getAdminReadNotificationIds();
        const pendingInspections = inspections.filter((order) => !["sent", "declined"].includes(String(order.contract_status || "").toLowerCase()));
        const delayedProgressOrders = progressOrders.filter((order) => (order.progress_stages || []).some((stage) => {
          const stageDelayed = !stage.completed && String(stage.status || "").toLowerCase().replace(/[ _]/g, "-") === "delayed";
          const subStageDelayed = (stage.subStages || []).some((subStage) => !subStage.completed && String(subStage.status || "").toLowerCase().replace(/[ _]/g, "-") === "delayed");
          return stageDelayed || subStageDelayed;
        }));
        const actionableRepairs = repairs.filter((repair) => (
          ["pending_review", "quotation_pending_approval", "customer_accepted", "admin_approved"].includes(String(repair.status || "").toLowerCase())
          || repair.payment?.proofReviewStatus === "pending"
        ));
        const visitedPath = location.pathname;
        const visitedIds = visitedPath === "/dashboard"
          ? newOrders.map((order) => getAdminNotificationId("new-order", order))
          : visitedPath === "/site-inspection"
            ? [
                ...pendingInspections.map((order) => getAdminNotificationId("inspection", order)),
                ...accepted.map((order) => getAdminNotificationId("accepted", order)),
                ...declined.map((order) => getAdminNotificationId("declined", order)),
                ...sent.map((order) => getAdminNotificationId("sent", order)),
              ]
            : visitedPath === "/transactions"
              ? payments.map((order) => getAdminNotificationId("payment", order))
              : visitedPath === "/progress-monitor"
                ? delayedProgressOrders.map((order) => getAdminNotificationId("progress-delay", order))
                : visitedPath === "/repair-requests"
                  ? actionableRepairs.map((repair) => getAdminNotificationId("repair", repair))
                : [];
        if (markVisitedPageRead && visitedIds.length) markAdminNotificationsRead(visitedIds);
        const readIds = markVisitedPageRead ? new Set([...read, ...visitedIds]) : read;
        const countUnread = (orders, type) => orders.filter((order) => !readIds.has(getAdminNotificationId(type, order))).length;
        if (active) setBadges({
          dashboard: countUnread(newOrders, "new-order"),
          siteInspection: countUnread(pendingInspections, "inspection") + countUnread(accepted, "accepted") + countUnread(declined, "declined") + countUnread(sent, "sent"),
          transactions: countUnread(payments, "payment"),
          progressMonitor: countUnread(delayedProgressOrders, "progress-delay"),
          repairManagement: countUnread(actionableRepairs, "repair"),
        });
      } catch (error) {
        console.error("Failed to refresh admin sidebar badges:", error);
      }
    };
    const scheduleRefresh = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(refresh, 100);
    };
    refresh(true);
    const unsubscribe = subscribeToRealtime(["orders", "reviews", "repairs"], scheduleRefresh);
    window.addEventListener("focus", scheduleRefresh);
    window.addEventListener("admin-notifications-updated", scheduleRefresh);
    const onStorage = (event) => { if (event.key === ADMIN_READ_NOTIFICATIONS_KEY) scheduleRefresh(); };
    window.addEventListener("storage", onStorage);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      unsubscribe();
      window.removeEventListener("focus", scheduleRefresh);
      window.removeEventListener("admin-notifications-updated", scheduleRefresh);
      window.removeEventListener("storage", onStorage);
    };
  }, [user, location.pathname]);

  if (isProvidedByAppShell && !forceRender) return null;

  const handleLogout = () => {
    setShowLogoutModal(false);
    logout();
  };

  const handleLogoClick = () => {
    startTransition(() => navigate("/dashboard"));
  };

  const mobileNavItems = [
    canViewStaffModule("dashboard") && { to: "/dashboard", label: "Dashboard", icon: <Gauge size={20} />, badge: badges.dashboard, active: location.pathname === "/dashboard" },
    canViewStaffModule("site_inspection") && { to: "/site-inspection", label: "Inspection", icon: <ClipboardCheck size={20} />, badge: badges.siteInspection, active: location.pathname === "/site-inspection" },
    canViewStaffModule("transactions") && { to: "/transactions", label: "Transactions", icon: <ReceiptText size={20} />, badge: badges.transactions, active: location.pathname === "/transactions" },
    canViewStaffModule("progress_monitoring") && { to: "/progress-monitor", label: "Monitor", icon: <ChartNoAxesCombined size={20} />, badge: badges.progressMonitor, active: location.pathname === "/progress-monitor" },
    canViewStaffModule("repair_management") && { to: "/repair-requests", label: "Repairs", icon: <Wrench size={20} />, badge: badges.repairManagement, active: location.pathname === "/repair-requests" },
    canViewStaffModule("product_management") && { to: "/product", label: "Products", icon: <Package size={20} />, active: location.pathname === "/product" },
    canViewStaffModule("settings") && { to: "/settings", label: "Settings", icon: <Settings size={20} />, active: location.pathname === "/settings" },
  ].filter(Boolean);

  return (
    <>
      <div
        onMouseEnter={handleSidebarMouseEnter}
        onMouseLeave={() => {
          cancelSidebarHoverOpen();
          setIsHovered(false);
        }}
        onFocusCapture={(event) => {
          if (pinMode !== "collapsed" && !event.target.closest("[data-sidebar-pin]")) setIsHovered(true);
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setIsHovered(false);
        }}
        className={`relative hidden shrink-0 transition-[width] duration-300 ease-in-out motion-reduce:transition-none lg:block ${isOpen ? "w-52" : "w-20"}`}
      >
        <aside
          className={`admin-sidebar relative h-full min-h-screen w-full border-r shadow-sm overflow-hidden ${darkMode ? "border-red-950/70 bg-gradient-to-b from-[#050817] via-[#10162d] to-[#3b0b1b] text-slate-100" : "border-slate-300 bg-gradient-to-b from-slate-100 via-white to-slate-200 text-slate-900"}`}
        >
        <div className={`pointer-events-none absolute -right-28 -top-24 h-72 w-72 rounded-full border ${darkMode ? "border-red-200/10" : "border-slate-900/10"}`} />
        <div className={`pointer-events-none absolute -right-16 -top-12 h-48 w-48 rounded-full border ${darkMode ? "border-red-200/10" : "border-slate-900/10"}`} />
        <div className={`pointer-events-none absolute -left-24 top-1/3 h-44 w-44 rounded-full border ${darkMode ? "border-blue-200/10" : "border-slate-900/10"}`} />
        <div className={`pointer-events-none absolute -left-14 top-[38%] h-24 w-24 rounded-full border ${darkMode ? "border-blue-200/10" : "border-slate-900/10"}`} />
        <div className={`pointer-events-none absolute -bottom-28 right-6 h-56 w-56 rounded-full border ${darkMode ? "border-red-200/10" : "border-slate-900/10"}`} />
        <div className={`pointer-events-none absolute -bottom-12 right-24 h-28 w-28 rounded-full border ${darkMode ? "border-red-200/10" : "border-slate-900/10"}`} />

        <div className={`relative z-10 flex border-b ${isOpen ? "items-center justify-center gap-1 p-2" : "flex-col items-center gap-2 p-2"}`}>
          <button
            type="button"
            onClick={handleLogoClick}
            className={`grid min-w-0 max-w-full cursor-pointer items-center text-left transition-[grid-template-columns,gap] duration-300 ease-in-out motion-reduce:transition-none ${isOpen ? "w-fit grid-cols-[40px_max-content] gap-2" : "w-full grid-cols-[1fr_0fr] gap-0"}`}
            aria-label="Go to dashboard"
          >
            <img
              src={logo}
              alt="ACGC Aluminum Services"
              className="h-10 w-10 shrink-0 justify-self-center object-contain drop-shadow-[0_0_5px_rgba(255,255,255,0.9)]"
            />

            <div className={`min-w-0 overflow-hidden transition-[max-width,opacity] duration-200 ease-in-out motion-reduce:transition-none ${isOpen ? "max-w-full opacity-100" : "max-w-0 opacity-0"}`}>
              <h1 className="whitespace-nowrap text-base font-bold leading-tight text-[#ff3038]">
                ACGC Services
              </h1>

              <p className={`whitespace-nowrap text-[10px] leading-tight font-bold tracking-[-0.03em] ${darkMode ? "text-slate-300" : "text-gray-700"}`}>
                Aluminum & Glass Services
              </p>
            </div>
          </button>
        </div>

        {/* MENU */}
        <nav className="mt-3 flex flex-col gap-1.5 px-2 py-1">

          {canViewStaffModule("dashboard") && <MenuItem
            to="/dashboard"
            icon={<Gauge size={20} />}
            label="Dashboard"
            badge={badges.dashboard}
            isOpen={isOpen}
            active={location.pathname === "/dashboard"}
            darkMode={darkMode}
            onIntent={() => prefetchAdminRoute("/dashboard")}
          />}

          {canViewStaffModule("site_inspection") && <MenuItem
            to="/site-inspection"
            icon={<ClipboardCheck size={20} />}
            label="Site Inspection"
            badge={badges.siteInspection}
            isOpen={isOpen}
            active={location.pathname === "/site-inspection"}
            darkMode={darkMode}
            onIntent={() => prefetchAdminRoute("/site-inspection")}
          />}

          {canViewStaffModule("transactions") && <MenuItem
            to="/transactions"
            icon={<ReceiptText size={20} />}
            label="Transactions"
            badge={badges.transactions}
            isOpen={isOpen}
            active={location.pathname === "/transactions"}
            darkMode={darkMode}
            onIntent={() => prefetchAdminRoute("/transactions")}
          />}

          {canViewStaffModule("progress_monitoring") && <MenuItem
            to="/progress-monitor"
            icon={<ChartNoAxesCombined size={20} />}
            label="Progress Monitor"
            badge={badges.progressMonitor}
            isOpen={isOpen}
            active={location.pathname === "/progress-monitor"}
            darkMode={darkMode}
            onIntent={() => prefetchAdminRoute("/progress-monitor")}
          />}

          {canViewStaffModule("repair_management") && <MenuItem
            to="/repair-requests"
            icon={<Wrench size={17} />}
            label="Repair Management"
            badge={badges.repairManagement}
            isOpen={isOpen}
            active={location.pathname === "/repair-requests"}
            darkMode={darkMode}
            onIntent={() => prefetchAdminRoute("/repair-requests")}
          />}

          {canViewStaffModule("product_management") && <MenuItem
            to="/product"
            icon={<Package size={20} />}
            label="Products"
            isOpen={isOpen}
            active={location.pathname === "/product"}
            darkMode={darkMode}
            onIntent={() => prefetchAdminRoute("/product")}
          />}

          {canViewStaffModule("profile") && <MenuItem
            to="/profile"
            icon={<UserCog size={20} />}
            label={user?.role === "skilled_worker" ? "Staff Profile" : "Admin Profile"}
            isOpen={isOpen}
            active={location.pathname === "/profile"}
            darkMode={darkMode}
            onIntent={() => prefetchAdminRoute("/profile")}
          />}

          {canViewStaffModule("settings") && <MenuItem
            to="/settings"
            icon={<Settings size={20} />}
            label="Settings"
            isOpen={isOpen}
            active={location.pathname === "/settings"}
            darkMode={darkMode}
            onIntent={() => prefetchAdminRoute("/settings")}
          />}

          {/* LOGOUT */}
          <button
            type="button"
            onClick={() => setShowLogoutModal(true)}
            title="Log out"
            aria-label="Log out"
            className={`group relative z-10 grid min-h-10 w-full items-center rounded-lg px-3 py-2 text-left text-sm text-red-600 transition-[grid-template-columns,gap,background-color,color] duration-200 motion-reduce:transition-none ${isOpen ? "grid-cols-[20px_minmax(0,1fr)] gap-2.5" : "grid-cols-[1fr_0fr] gap-0"} ${darkMode ? "hover:bg-red-950/70 hover:text-red-300" : "hover:bg-red-50 hover:text-red-700"}`}
          >
            <LogOut size={20} className="shrink-0 justify-self-center" />
            <span className={`min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ease-in-out motion-reduce:transition-none ${isOpen ? "max-w-full opacity-100" : "max-w-0 opacity-0"}`}>
              Log out
            </span>
          </button>

        </nav>
        <button
          type="button"
          data-sidebar-pin
          onMouseEnter={cancelSidebarHoverOpen}
          onClick={toggleSidebarPin}
          aria-label={pinMode === "open" ? "Unpin expanded sidebar" : pinMode === "collapsed" ? "Unpin collapsed sidebar" : isHovered ? "Pin sidebar open" : "Pin collapsed sidebar"}
          aria-pressed={Boolean(pinMode)}
          title={pinMode === "open" ? "Unpin expanded sidebar" : pinMode === "collapsed" ? "Unpin collapsed sidebar" : isHovered ? "Pin sidebar open" : "Pin collapsed sidebar"}
          className={`absolute bottom-4 right-3 z-20 inline-flex h-10 w-10 items-center justify-center rounded-xl border-2 shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 ${pinMode ? "border-red-700 bg-red-600 text-white shadow-red-900/30 hover:bg-red-700" : darkMode ? "border-amber-400 bg-amber-300 text-red-900 shadow-black/30 hover:bg-amber-200" : "border-amber-500 bg-amber-300 text-red-900 shadow-amber-900/20 hover:bg-amber-200"}`}
        >
          <Pin size={20} className={pinMode ? "fill-current" : ""} aria-hidden="true" />
        </button>
        </aside>
      </div>

      <nav
        aria-label="Admin navigation"
        className={`admin-mobile-navigation fixed inset-x-0 bottom-0 z-[60] flex w-full items-center justify-around gap-0 border-t px-1 pt-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur-xl lg:hidden ${darkMode ? "border-slate-800 bg-slate-950/95" : "border-slate-200 bg-white/95"}`}
      >
        {mobileNavItems.map(({ to, label, icon, active, badge }) => (
          <Link
            key={to}
            to={to}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            title={label}
            onClick={(event) => handleSpaNavigation(event, to, navigate)}
            onPointerEnter={() => prefetchAdminRoute(to)}
            onPointerDown={() => prefetchAdminRoute(to)}
            onFocus={() => prefetchAdminRoute(to)}
          className={`group relative flex h-[58px] min-w-0 flex-1 flex-col items-center justify-center rounded-lg px-0 text-center transition-[transform,background-color,color] duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-reduce:transform-none motion-reduce:transition-none ${active ? darkMode ? "text-white" : "text-slate-900" : darkMode ? "text-slate-400 hover:bg-slate-800 hover:text-slate-100" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"}`}
          >
            <span className="relative inline-flex">
              <span
                className={[
                  "relative z-10 flex items-center justify-center transition-[transform,width,height,border-radius,background-color,border-color,color,box-shadow] duration-[220ms] ease-out group-hover:scale-105 group-active:scale-90 motion-reduce:transition-none",
                  active ? "-translate-y-6 size-10 rounded-full border-2 ring-4 shadow-lg" : "size-7 rounded-lg",
                  active
                    ? darkMode
                      ? "border-slate-900 bg-gradient-to-br from-brand-dark-fill via-brand to-red-700 text-white ring-red-300/30 shadow-black/50"
                      : "border-white bg-gradient-to-br from-brand via-red-800 to-red-600 text-white ring-red-400/35 shadow-red-900/35"
                    : darkMode
                      ? "text-slate-300 group-hover:bg-white/[0.06]"
                      : "text-slate-600 group-hover:bg-black/[0.04]",
                ].join(" ")}
                aria-hidden="true"
              >
                {icon}
              </span>
              {badge > 0 && <span className={`absolute -right-2 -top-1 z-20 inline-flex h-4 min-w-4 items-center justify-center rounded-full border px-1 text-[9px] font-bold leading-none ${darkMode ? "border-slate-900 bg-red-500 text-white" : "border-white bg-red-600 text-white"}`} aria-label={`${badge} unread notifications`}>{badge > 99 ? "99+" : badge}</span>}
            </span>
            <span className={`mt-0.5 whitespace-nowrap leading-[12px] transition-opacity duration-150 motion-reduce:transition-none ${active ? "text-[8px] font-bold opacity-100" : "text-[7px] font-medium opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`} aria-hidden="true">{label}</span>
          </Link>
        ))}
      </nav>

      {/* LOGOUT MODAL */}
      {showLogoutModal && createPortal(
        <div className="fixed inset-0 z-[100] flex min-h-screen items-center justify-center p-4">
          <div
            className="logout-modal-backdrop-in absolute inset-0 bg-black/45 backdrop-blur-md"
            onClick={() => setShowLogoutModal(false)}
          />
          <div className={`logout-modal-in relative z-40 w-full max-w-sm rounded-2xl p-6 text-center shadow-2xl ${darkMode ? "bg-slate-800 text-white" : "bg-white text-slate-900"}`}>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
              <LogOut size={22} />
            </div>
            <h3 className="mt-4 text-lg font-semibold">Confirm Logout</h3>
            <p className={`mt-2 text-sm ${darkMode ? "text-slate-300" : "text-gray-600"}`}>
              Are you sure you want to log out?
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <button
                onClick={() => setShowLogoutModal(false)}
                className={`rounded-lg px-3 py-1 ${darkMode ? "bg-slate-700 text-slate-100 hover:bg-slate-600" : "bg-gray-100 hover:bg-gray-200"}`}
              >
                Cancel
              </button>
              <button
                onClick={handleLogout}
                className="rounded-lg bg-red-600 px-3 py-1 text-white hover:bg-red-700"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function MenuItem({
  to,
  icon,
  label,
  isOpen,
  active,
  nested = false,
  darkMode = false,
  onIntent,
  badge = 0,
}) {
  const navigate = useNavigate();

  return (
    <Link
      to={to}
      title={label}
      onClick={(event) => handleSpaNavigation(event, to, navigate)}
      onPointerEnter={onIntent}
      onPointerDown={onIntent}
      onFocus={onIntent}
      className={`group relative grid min-h-10 w-full items-center rounded-lg px-3 py-2 text-sm transition-[grid-template-columns,gap,background-color,color,transform] duration-200 ease-out hover:translate-x-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 motion-reduce:transition-none motion-reduce:hover:translate-x-0 ${
        active
          ? darkMode
            ? "border border-red-800/70 bg-red-950/40 text-red-200 shadow-[inset_3px_0_0_#f87171]"
            : "border border-red-200 bg-red-50/80 text-red-950 shadow-[inset_3px_0_0_#b91c1c]"
          : darkMode
            ? "text-slate-300 hover:bg-red-950/70 hover:text-red-200"
            : "text-gray-700 hover:bg-red-50 hover:text-red-700"
      } ${isOpen ? "grid-cols-[20px_minmax(0,1fr)] gap-2.5" : "grid-cols-[1fr_0fr] gap-0"} ${nested ? "ml-5 w-[calc(100%-1.25rem)] rounded-l-none rounded-r-xl border-l-2 border-slate-300/60 pl-3 dark:border-slate-700" : ""}`}
    >
      <span className={`relative shrink-0 justify-self-center transition-transform duration-200 ease-out motion-reduce:transition-none ${
        isOpen ? "" : "group-hover:-translate-y-0.5 group-hover:scale-110 motion-reduce:group-hover:translate-y-0 motion-reduce:group-hover:scale-100"
      }`}>{icon}</span>
      <span className={`min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ease-in-out motion-reduce:transition-none ${
        isOpen ? "max-w-full opacity-100" : "max-w-0 opacity-0"
      }`}>
        <span className="flex items-center justify-between gap-2">
          <span className="truncate">{label}</span>
          {badge > 0 && <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white" aria-label={`${badge} unread notifications`}>{badge > 99 ? "99+" : badge}</span>}
        </span>
      </span>
      {badge > 0 && !isOpen && <span className="absolute right-2 top-1.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" aria-label={`${badge} unread notifications`} />}
    </Link>
  );
}

export default Sidebar;
