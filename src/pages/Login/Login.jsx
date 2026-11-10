import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  Eye,
  EyeOff,
  ChevronLeft,
  Mail,
  MailCheck,
  LockKeyhole,
  LoaderCircle,
} from "lucide-react";

import logo from "../../assets/images/ACGCLOGO1.png";

function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, authError, setAuthError, loginLoading } = useAuth();

  const [registrationNotice] = useState(() => {
    const notice = location.state?.registrationNotice;
    return notice?.registeredEmail ? notice : null;
  });
  const [showPassword, setShowPassword] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [formData, setFormData] = useState({
    identifier: "",
    password: "",
    remember: false,
  });
  const [error, setError] = useState("");

  useEffect(() => {
    const notice = location.state?.registrationNotice;
    if (!notice?.registeredEmail) return;

    const remainingState = { ...location.state };
    delete remainingState.registrationNotice;
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: Object.keys(remainingState).length ? remainingState : null,
    });
  }, [location.hash, location.pathname, location.search, location.state, navigate]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;

    setFormData({
      ...formData,
      [name]: type === "checkbox" ? checked : value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (loginLoading || redirecting) {
      return;
    }

    if (!formData.identifier || !formData.password) {
      setError("Please enter your email/username and password.");
      return;
    }

    try {
      setError("");
      setAuthError("");
      const response = await login({
        identifier: formData.identifier,
        password: formData.password,
      });

      const pendingProductEmail = String(location.state?.pendingProductEmail || "").trim().toLowerCase();
      const authenticatedEmail = String(response.user?.email || "").trim().toLowerCase();
      const pendingProductBelongsToAccount = !pendingProductEmail || pendingProductEmail === authenticatedEmail;
      const requestedFrom = pendingProductBelongsToAccount ? location.state?.from : null;
      const requestedPath = requestedFrom?.pathname;
      const requestedSearch = requestedFrom?.search || "";
      const requestedHash = requestedFrom?.hash || "";
      const pendingCartAdd = location.state?.pendingCartAdd;
      const isCustomer = response.user?.role === "customer";
      const pendingCartEmail = String(pendingCartAdd?.registeredEmail || "").trim().toLowerCase();
      const pendingCartBelongsToAccount = !pendingCartEmail || pendingCartEmail === authenticatedEmail;
      const isCustomerDestination = requestedPath === "/customer-dashboard"
        || requestedPath?.startsWith("/customer-dashboard/");
      const isPendingCartAction = isCustomer
        && pendingCartBelongsToAccount
        && Boolean(pendingCartAdd?.actionId && pendingCartAdd?.productId);
      const isSafeAdminDestination = requestedPath?.startsWith("/")
        && !requestedPath.startsWith("//")
        && !isCustomerDestination;
      const destination = isCustomer
        ? isCustomerDestination
          ? `${requestedPath}${requestedSearch}${requestedHash}`
          : isPendingCartAction
            ? "/customer-dashboard?tab=cart"
            : "/customer-dashboard"
        : isSafeAdminDestination
          ? `${requestedPath}${requestedSearch}${requestedHash}`
          : "/dashboard";
      setRedirecting(true);
      navigate(destination, {
        replace: true,
        state: isPendingCartAction ? { pendingCartAdd } : undefined,
      });
    } catch (err) {
      setError(err.data?.message || err.message || "Login failed.");
    }
  };

  return (
    <div className="auth-light-canvas flex h-[100dvh] min-h-[100dvh] items-stretch justify-center overflow-hidden lg:items-center lg:px-4 lg:py-5">

      <div className="relative z-10 h-[100dvh] w-full max-w-none overflow-hidden bg-slate-900/90 lg:h-auto lg:max-w-5xl lg:rounded-[22px] lg:border lg:border-white/10 lg:shadow-[0_28px_90px_rgba(2,6,23,0.65)] lg:backdrop-blur-xl">

        <div className="grid h-full grid-rows-[minmax(10rem,30dvh)_minmax(0,1fr)] lg:h-auto lg:grid-cols-2 lg:grid-rows-1">

          {/* LEFT SIDE */}

          <div className="relative flex min-h-0 flex-col items-center justify-center gap-2 overflow-hidden bg-gradient-to-br from-slate-950 via-[#111827] to-[#450a0a] p-4 text-white sm:gap-3 lg:p-8">

            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(148,163,184,.08),transparent_42%,rgba(127,29,29,.28))]" />
            <div className="pointer-events-none absolute -right-28 -top-20 h-80 w-80 rounded-full border border-white/10" />
            <div className="pointer-events-none absolute -right-16 -top-8 h-56 w-56 rounded-full border border-white/10" />
            <div className="relative z-10 flex min-w-0 flex-col items-center text-center">

              <p className="mb-2 text-[10px] font-black uppercase tracking-[0.28em] text-red-100 sm:text-xs lg:mb-6 lg:tracking-[0.3em]">
                Welcome To
              </p>

              <img
                src={logo}
                alt="ACGC Logo"
                className="mb-2 w-28 drop-shadow-[0_0_4px_rgba(255,255,255,0.7)] sm:mb-3 sm:w-36 lg:mx-auto lg:w-56"
              />

              <p className="mt-2 max-w-md text-center text-[11px] font-medium leading-4 text-red-50 sm:text-xs lg:mx-auto lg:mt-6 lg:text-sm lg:leading-6">
                Securely manage products, site inspections,
                and operations from one powerful dashboard.
              </p>

            </div>

          </div>

          {/* RIGHT SIDE */}

          <div className="min-h-0 overflow-y-auto overscroll-contain bg-white px-4 py-2 text-slate-900 sm:px-6 sm:py-2 lg:flex lg:items-center lg:p-8">

            <div className="mx-auto flex min-h-full w-full max-w-md flex-col lg:min-h-0">
              
              <h1 className="mt-1 text-xl font-black tracking-tight text-slate-900 sm:text-2xl lg:text-4xl">
                Sign in to ACGC
              </h1>

              <p className="mt-1 text-xs leading-5 text-slate-500 sm:text-sm">
                Enter your credentials to continue.
              </p>

              {registrationNotice ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="mt-3 flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-3 text-sm text-sky-900 sm:px-4"
                >
                  <MailCheck size={19} className="mt-0.5 shrink-0 text-sky-700" aria-hidden="true" />
                  <span className="min-w-0 break-words">
                    Please check your email and verify your account before logging in.
                    <span className="mt-1 block text-xs text-sky-800">
                      Verification email sent to {registrationNotice.registeredEmail}.
                    </span>
                  </span>
                </div>
              ) : null}

              <form
                onSubmit={handleSubmit}
                className="mt-3 flex flex-1 flex-col gap-2 sm:mt-3 lg:mt-4 lg:gap-3"
              >

                {/* USERNAME */}

                <div>

                    <label className="mb-1 block text-sm font-semibold text-slate-700">
                    Email or Username
                  </label>

                  <div className="relative">
                    <Mail
                      size={20}
                      strokeWidth={1.8}
                      className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      type="text"
                      name="identifier"
                      value={formData.identifier}
                      onChange={handleChange}
                      placeholder="Email or username"
                      className="h-11 w-full rounded-xl border border-slate-300 bg-slate-50 pl-11 pr-4 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-red-500 focus:bg-white focus:ring-4 focus:ring-red-500/10 sm:pl-12 sm:pr-5"
                    />
                  </div>

                </div>

                {/* PASSWORD */}

                <div>

                  <label className="mb-1 block text-sm font-semibold text-slate-700">
                    Password
                  </label>

                  <div className="relative">

                    <LockKeyhole
                      size={20}
                      strokeWidth={1.8}
                      className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />

                    <input
                      type={
                        showPassword
                          ? "text"
                          : "password"
                      }
                      name="password"
                      value={formData.password}
                      onChange={handleChange}
                      placeholder="Password"
                      className="h-11 w-full rounded-xl border border-slate-300 bg-slate-50 pl-11 pr-12 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-red-500 focus:bg-white focus:ring-4 focus:ring-red-500/10 sm:pl-12 sm:pr-14"
                    />

                    <button
                      type="button"
                      onClick={() =>
                        setShowPassword(!showPassword)
                      }
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-red-600"
                    >
                      {showPassword ? (
                        <EyeOff size={22} />
                      ) : (
                        <Eye size={22} />
                      )}
                    </button>

                  </div>

                </div>

                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-1">
                  <label className="flex items-center gap-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      name="remember"
                      checked={formData.remember}
                      onChange={handleChange}
                      className="h-4 w-4 accent-red-600"
                    />
                    Remember me
                  </label>
                  <Link
                    to="/forgot-password"
                    className="text-sm font-semibold text-brand transition-opacity hover:opacity-80"
                  >
                    Forgot Password?
                  </Link>
                </div>

                {/* LOGIN BUTTON */}

                {error || authError ? (
                  <p className="text-sm text-red-600 font-medium">
                    {error || authError}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={loginLoading || redirecting}
                  className={`min-h-11 w-full rounded-xl bg-brand text-base font-bold text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${loginLoading || redirecting ? "cursor-not-allowed opacity-60" : ""}`}
                >
                  {loginLoading || redirecting ? (
                    <span className="flex items-center justify-center gap-2">
                      <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
                      Logging in...
                    </span>
                  ) : (
                    "Login"
                  )}
                </button>

                {/* BACK BUTTON */}

                <Link
                  to="/"
                  className="flex min-h-11 w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-slate-100 text-sm font-bold text-slate-700 transition hover:border-slate-400 hover:bg-slate-200"
                >
                  <ChevronLeft size={22} />
                  Back to Browse
                </Link>

                <div className="mt-2 flex shrink-0 flex-wrap justify-center gap-x-2 gap-y-1 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs sm:gap-4 sm:py-2 sm:text-sm lg:mt-auto">
                  <span className="text-slate-500">Don't have an account?</span>
                  <Link
                    to="/signup"
                    state={location.state}
                    className="font-bold text-brand transition-opacity hover:opacity-80"
                  >
                    Sign Up
                  </Link>
                </div>

              </form>

            </div>

          </div>

        </div>

      </div>

    </div>
  );
}

export default Login;
