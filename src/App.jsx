import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
const ForgotPassword = lazy(() => import("./pages/ForgotPassword/ForgotPassword"));
const AdminRecovery = lazy(() => import("./pages/AdminRecovery/AdminRecovery"));
const LandingPage = lazy(() => import("./pages/LandingPage/LandingPage"));
const Login = lazy(() => import("./pages/Login/Login"));
const Signup = lazy(() => import("./pages/Signup/Signup"));
const VerifyEmail = lazy(() => import("./pages/VerifyEmail/VerifyEmail"));
const LegalDocumentPage = lazy(() => import("./pages/LegalDocument/LegalDocumentPage"));
const Dashboard = lazy(() => import("./pages/Dashboard/Dashboard"));
const TrackOrder = lazy(() => import("./pages/TrackOrder/TrackOrder"));
const SiteInspection = lazy(() => import("./pages/SiteInspection/SiteInspection"));
const Notifications = lazy(() => import("./pages/Notifications/Notifications"));
const Transactions = lazy(() => import("./pages/Transactions/Transactions"));
const RepairRequests = lazy(() => import("./pages/RepairRequests/RepairRequests"));
const ProgressMonitor = lazy(() => import("./pages/ProgressMonitor/ProgressMonitor"));
const Product = lazy(() => import("./pages/Product/Product"));
const AdminProfile = lazy(() => import("./pages/AdminProfile/AdminProfile"));
const Settings = lazy(() => import("./pages/Settings/Settings"));
const CustomerDashboard = lazy(() => import("./pages/CustomerDashboard/CustomerDashboard"));
import AdminCreationModal from "./components/AdminCreationModal";
import { AuthProvider } from "@/contexts/AuthContext";
import { RealtimeProvider } from "@/contexts/RealtimeProvider";
import { useAuth } from "@/contexts/AuthContext";
import { AdminThemeProvider, useAdminTheme } from "@/contexts/AdminThemeContext";
import ProtectedRoute from "@/components/layout/ProtectedRoute";
import Sidebar from "@/components/layout/Sidebar";
import KeepAliveOutlet from "@/components/layout/KeepAliveOutlet";
import AdminNavigationContext from "@/contexts/AdminNavigationContext";
import { LoaderCircle, RefreshCw } from "lucide-react";
import logo from "./assets/images/ACGCLOGO1.png";

const ADMIN_ROUTE_PATHS = new Set([
  "/dashboard",
  "/site-inspection",
  "/notifications",
  "/transactions",
  "/repair-requests",
  "/progress-monitor",
  "/product",
  "/profile",
  "/settings",
]);

const PUBLIC_TRANSITION_PATHS = new Set(["/", "/login", "/signup", "/forgot-password"]);
const PUBLIC_PAGE_POSITIONS = {
  "/": { x: 0, y: 0 },
  "/signup": { x: 1, y: 0 },
  "/login": { x: 1, y: 1 },
  "/forgot-password": { x: 0, y: 1 },
};

const publicPageVariants = {
  initial: (direction) => ({
    opacity: 0,
    x: direction.x * 24,
    y: direction.y * 24,
    scale: 0.998,
  }),
  enter: { opacity: 1, x: 0, y: 0, scale: 1 },
  exit: (direction) => ({
    opacity: 0,
    x: direction.x * -14,
    y: direction.y * -14,
    scale: 0.999,
  }),
};

function PublicPageRoutes() {
  const location = useLocation();
  const shouldReduceMotion = useReducedMotion();
  const isPublicTransitionPage = PUBLIC_TRANSITION_PATHS.has(location.pathname);
  const previousPathRef = useRef(location.pathname);
  const directionRef = useRef({ x: 0, y: 0 });
  const landingTransitionRef = useRef(false);

  if (previousPathRef.current !== location.pathname) {
    const previousPath = previousPathRef.current;
    const previousPosition = PUBLIC_PAGE_POSITIONS[previousPath];
    const nextPosition = PUBLIC_PAGE_POSITIONS[location.pathname];
    landingTransitionRef.current = previousPath === "/" || location.pathname === "/";
    if (previousPosition && nextPosition) {
      directionRef.current = location.pathname === "/"
        ? { x: -1, y: 0 }
        : previousPath === "/" && location.pathname === "/login"
          ? { x: 1, y: 0 }
        : {
          x: Math.sign(nextPosition.x - previousPosition.x),
          y: Math.sign(nextPosition.y - previousPosition.y),
        };
    } else {
      directionRef.current = { x: 0, y: 0 };
    }
    previousPathRef.current = location.pathname;
  }

  const direction = shouldReduceMotion ? { x: 0, y: 0 } : directionRef.current;

  return (
    <AnimatePresence mode="wait" initial={false} custom={direction}>
      {isPublicTransitionPage && (
        <motion.div
          key={location.pathname}
          className="public-page-transition"
          custom={direction}
          variants={publicPageVariants}
          initial="initial"
          animate="enter"
          exit="exit"
          transition={{
            duration: shouldReduceMotion ? 0.1 : landingTransitionRef.current ? 0.42 : 0.3,
            ease: [0.16, 1, 0.3, 1],
          }}
        >
          <Routes location={location}>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
          </Routes>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function AdminLayout({ isSidebarOpen, onSidebarToggle }) {
  return (
    <AdminNavigationContext.Provider value>
      <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        <Sidebar
          key="shared-admin-sidebar"
          forceRender
          isOpen={isSidebarOpen}
          onToggle={onSidebarToggle}
        />
        <main className="min-h-0 min-w-0 flex-1">
          <Suspense fallback={null}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </AdminNavigationContext.Provider>
  );
}


function LogoutLoadingScreen() {
  return (
    <div className="login-loading-page min-h-screen bg-gradient-to-br from-[#0f0f0f] via-[#1a0000] to-[#0f0f0f] flex items-center justify-center px-4">
      <div className="text-center text-white">
        <img
          src={logo}
          alt="ACGC Logo"
          className="login-loading-logo w-56 mx-auto drop-shadow-2xl"
        />
        <div className="login-loading-spinner-wrap mx-auto mt-10">
          <LoaderCircle
            size={52}
            strokeWidth={2.5}
            className="login-loading-spinner text-red-500"
            aria-hidden="true"
          />
        </div>
        <h1 className="login-loading-heading mt-6 text-3xl font-black">
          Signing you out...
        </h1>
        <p className="login-loading-text mt-3 text-slate-300">
          Securing your session
        </p>
        <div className="login-loading-dots mt-6" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

function AppRoutes() {
  const { logoutLoading, user } = useAuth();
  const { darkMode } = useAdminTheme();
  const location = useLocation();
  const publicLightRoutes = new Set([
    "/",
    "/login",
    "/signup",
    "/privacy-policy",
    "/terms-and-conditions",
    "/verify-email",
    "/forgot-password",
    "/reset-password",
    "/admin-recovery",
    "/track-order",
  ]);
  const isPublicLightRoute = publicLightRoutes.has(location.pathname);
  const routePath = location.pathname.replace(/\/+$/, "") || "/";
  const isAdminRoute = Boolean(user && ["admin", "super_admin", "skilled_worker"].includes(user.role)) && ADMIN_ROUTE_PATHS.has(routePath);
  const usesAdminTheme = !isPublicLightRoute && (user?.role === "admin" || user?.role === "super_admin" || user?.role === "skilled_worker");
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("sidebarOpen");
    return stored !== null ? JSON.parse(stored) : true;
  });
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullDistanceRef = useRef(0);
  const touchStartY = useRef(null);
  const touchStartX = useRef(null);
  const refreshTriggered = useRef(false);

  useEffect(() => {
    localStorage.setItem("sidebarOpen", JSON.stringify(isSidebarOpen));
  }, [isSidebarOpen]);

  useEffect(() => {
    const isBlockedTarget = (target) =>
      target instanceof Element &&
      target.closest(
        'input, textarea, select, button, a, [contenteditable="true"], [role="dialog"], dialog, [data-no-pull-refresh]',
      );

    const isAtTop = (target) => {
      let element = target instanceof Element ? target : null;

      while (element && element !== document.body) {
        const styles = window.getComputedStyle(element);
        const isScrollable =
          /(auto|scroll)/.test(styles.overflowY) &&
          element.scrollHeight > element.clientHeight;

        if (isScrollable) {
          return element.scrollTop <= 0;
        }

        element = element.parentElement;
      }

      return (
        document.scrollingElement?.scrollTop <= 0 &&
        window.scrollY <= 0
      );
    };

    const handleTouchStart = (event) => {
      if (
        event.touches.length !== 1 ||
        isBlockedTarget(event.target) ||
        !isAtTop(event.target)
      ) {
        touchStartY.current = null;
        touchStartX.current = null;
        return;
      }

      touchStartY.current = event.touches[0].clientY;
      touchStartX.current = event.touches[0].clientX;
    };

    const handleTouchMove = (event) => {
      if (touchStartY.current === null || event.touches.length !== 1) return;

      const distance = event.touches[0].clientY - touchStartY.current;
      const horizontalDistance =
        event.touches[0].clientX - touchStartX.current;
      if (
        distance <= 0 ||
        Math.abs(horizontalDistance) >= distance ||
        !isAtTop(event.target)
      ) {
        touchStartY.current = null;
        touchStartX.current = null;
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }

      if (event.cancelable) event.preventDefault();
      const nextDistance = Math.min(distance, 84);
      pullDistanceRef.current = nextDistance;
      setPullDistance(nextDistance);
    };

    const handleTouchEnd = () => {
      if (pullDistanceRef.current >= 72 && !refreshTriggered.current) {
        refreshTriggered.current = true;
        setRefreshing(true);
        window.dispatchEvent(new CustomEvent("acgc:realtime", {
          detail: { area: "all", action: "reconcile", timestamp: new Date().toISOString() },
        }));
        window.setTimeout(() => {
          pullDistanceRef.current = 0;
          refreshTriggered.current = false;
          setPullDistance(0);
          setRefreshing(false);
        }, 400);
      } else {
        pullDistanceRef.current = 0;
        setPullDistance(0);
      }

      touchStartY.current = null;
      touchStartX.current = null;
    };

    const handleTouchCancel = () => {
      touchStartY.current = null;
      touchStartX.current = null;
      pullDistanceRef.current = 0;
      setPullDistance(0);
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", handleTouchCancel, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, []);

  if (logoutLoading) {
    return <LogoutLoadingScreen />;
  }

  return (
    <div className={`admin-theme-shell relative ${isAdminRoute ? "flex h-screen overflow-hidden" : ""} ${isPublicLightRoute ? "public-light-theme" : ""} ${usesAdminTheme ? (darkMode ? "admin-theme-dark" : "admin-theme-light") : ""}`}>
      {(pullDistance > 0 || refreshing) && (
        <div
          aria-live="polite"
          className="pointer-events-none fixed left-1/2 top-0 z-[10000] flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-lg transition-transform"
          style={{
            opacity: refreshing ? 1 : Math.min(pullDistance / 32, 1),
            transform: `translate(-50%, ${refreshing ? 12 : Math.min(pullDistance - 40, 12)}px)`,
          }}
        >
          <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
          {refreshing
            ? "Refreshing..."
            : pullDistance >= 72
              ? "Release to refresh"
              : "Pull to refresh"}
        </div>
      )}
      {(user?.role === "admin" || user?.role === "super_admin") && (
        <div className="admin-shell-drawing" aria-hidden="true">
          <div className="admin-shell-circle admin-shell-circle-top" />
          <div className="admin-shell-circle admin-shell-circle-top-small" />
          <div className="admin-shell-circle admin-shell-circle-middle" />
          <div className="admin-shell-circle admin-shell-circle-middle-small" />
          <div className="admin-shell-circle admin-shell-circle-bottom" />
          <div className="admin-shell-circle admin-shell-circle-bottom-small" />
        </div>
      )}
      <AdminCreationModal />
      <Suspense fallback={null}>
      <PublicPageRoutes />
      <Routes>
          <Route path="/" element={null} />
          <Route path="/login" element={null} />
          <Route path="/signup" element={null} />
          <Route path="/forgot-password" element={null} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/privacy-policy" element={<LegalDocumentPage documentType="privacyPolicy" />} />
          <Route path="/terms-and-conditions" element={<LegalDocumentPage documentType="termsAndConditions" />} />
          <Route path="/admin-recovery" element={<AdminRecovery />} />
          <Route path="/track-order" element={<TrackOrder />} />
          <Route element={<AdminLayout
            isSidebarOpen={isSidebarOpen}
            onSidebarToggle={() => setIsSidebarOpen((open) => !open)}
          />}>
          <Route element={<KeepAliveOutlet key={`${user?._id || user?.id || "anonymous"}:${user?.role || ""}:${JSON.stringify(user?.staff_access?.modules || {})}`} />}>
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute roles={["admin", "super_admin", "skilled_worker"]} requiredModule="dashboard">
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/site-inspection"
            element={
              <ProtectedRoute roles={["admin", "super_admin", "skilled_worker"]} requiredModule="site_inspection">
                <SiteInspection />
              </ProtectedRoute>
            }
          />
          <Route
            path="/notifications"
            element={
              <ProtectedRoute roles={["admin", "super_admin", "skilled_worker"]} requiredModule="transactions">
                <Notifications />
              </ProtectedRoute>
            }
          />
          <Route
            path="/transactions"
            element={
              <ProtectedRoute roles={["admin", "super_admin", "skilled_worker"]} requiredModule="transactions">
                <Transactions />
              </ProtectedRoute>
            }
          />
          <Route
            path="/repair-requests"
            element={
              <ProtectedRoute roles={["admin", "super_admin", "skilled_worker"]} requiredModule="repair_management">
                <RepairRequests />
              </ProtectedRoute>
            }
          />
          <Route
            path="/progress-monitor"
            element={
              <ProtectedRoute roles={["admin", "super_admin", "skilled_worker"]} requiredModule="progress_monitoring">
                <ProgressMonitor />
              </ProtectedRoute>
            }
          />
          <Route
            path="/product"
            element={
              <ProtectedRoute roles={["admin", "super_admin", "skilled_worker"]} requiredModule="product_management">
                <Product />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute roles={["admin", "super_admin", "skilled_worker"]} requiredModule="profile">
                <AdminProfile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute roles={["admin", "super_admin", "skilled_worker"]} requiredModule="settings">
                <Settings />
              </ProtectedRoute>
            }
          />
          </Route>
          </Route>
          <Route
            path="/customer-dashboard/*"
            element={
              <ProtectedRoute roles={["customer"]}>
                <CustomerDashboard />
              </ProtectedRoute>
            }
          />
      </Routes>
      </Suspense>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <RealtimeProvider>
          <AdminThemeProvider>
            <AppRoutes />
          </AdminThemeProvider>
        </RealtimeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
