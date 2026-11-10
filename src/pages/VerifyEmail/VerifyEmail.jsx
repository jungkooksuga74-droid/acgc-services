import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, LoaderCircle, XCircle } from "lucide-react";
import { verifyEmail } from "@/api/auth";
import { consumePendingProductRedirectForVerification } from "@/lib/pendingProductAction";
import { consumePendingGuestCartAddForVerification } from "@/lib/pendingGuestCartAdd";

function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("Verifying your email address...");
  const token = searchParams.get("token");

  useEffect(() => {
    if (!token) return;

    verifyEmail(token)
      .then(() => {
        setStatus("success");
        setMessage("Your account has been successfully verified!");
      })
      .catch((error) => {
        setStatus("error");
        setMessage(error.data?.message || error.message || "Unable to verify your email.");
      });
  }, [token]);

  const visibleStatus = token ? status : "error";
  const visibleMessage = token ? message : "This verification link is missing its token.";
  const isSuccess = visibleStatus === "success";
  const handleContinue = () => {
    const productRedirect = consumePendingProductRedirectForVerification();
    const pendingCartAdd = consumePendingGuestCartAddForVerification();
    navigate("/login", {
      replace: true,
      state: {
        ...(productRedirect?.from ? { from: productRedirect.from } : {}),
        ...(productRedirect?.registeredEmail ? { pendingProductEmail: productRedirect.registeredEmail } : {}),
        ...(pendingCartAdd ? { pendingCartAdd } : {}),
        message: "Email verified successfully. You can now log in.",
      },
    });
  };

  return (
    <main className="verify-email-page relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
      <div className="verify-email-orb verify-email-orb-one" aria-hidden="true" />
      <div className="verify-email-orb verify-email-orb-two" aria-hidden="true" />
      {isSuccess && (
        <div className="verify-confetti-layer" aria-hidden="true">
          {Array.from({ length: 36 }, (_, index) => (
            <span
              key={index}
              className="verify-confetti-piece"
              style={{
                left: `${(index * 37 + 7) % 100}%`,
                animationDelay: `${(index % 12) * 0.09}s`,
                animationDuration: `${2.2 + (index % 7) * 0.22}s`,
                backgroundColor: ["#dc2626", "#f59e0b", "#10b981", "#3b82f6", "#a855f7"][index % 5],
              }}
            />
          ))}
        </div>
      )}
      <section key={visibleStatus} aria-live="polite" className={`relative z-10 w-full max-w-lg overflow-hidden rounded-[28px] border border-slate-200/80 bg-white px-7 py-10 text-center shadow-[0_24px_80px_rgba(15,23,42,0.12)] sm:px-12 sm:py-12 ${isSuccess ? "verify-success-card" : "verify-loading-card"}`}>
        <div className={`mx-auto flex size-[76px] items-center justify-center rounded-[25px] ${isSuccess ? "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100" : "bg-red-50 text-red-600 ring-1 ring-red-100"}`}>
          {visibleStatus === "loading" ? <LoaderCircle size={38} className="animate-spin" aria-hidden="true" /> : isSuccess ? <CheckCircle2 size={44} className="verify-success-icon" aria-hidden="true" /> : <XCircle size={42} aria-hidden="true" />}
        </div>
        <p className={`mt-7 text-[11px] font-extrabold uppercase tracking-[0.24em] ${isSuccess ? "text-emerald-700" : "text-red-700"}`}>
          {isSuccess ? "Email confirmed" : visibleStatus === "error" ? "Verification issue" : "Account security"}
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-[34px]">
          {visibleStatus === "loading" ? "Verifying your email" : isSuccess ? "Account Verified" : "Verification failed"}
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-[15px] leading-7 text-slate-600 sm:text-base">
          {isSuccess ? <><span className="block">Your account has been</span><span className="block">successfully verified!</span></> : visibleMessage}
        </p>
        {visibleStatus === "loading" && <div className="mx-auto mt-8 h-1.5 max-w-[220px] overflow-hidden rounded-full bg-slate-100"><div className="verify-loading-bar h-full rounded-full bg-red-600" /></div>}
        {isSuccess ? (
          <button type="button" onClick={handleContinue} className="mt-8 inline-flex min-h-12 min-w-44 items-center justify-center rounded-xl bg-red-700 px-7 py-3 font-bold text-white shadow-lg shadow-red-700/20 transition hover:-translate-y-0.5 hover:bg-red-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-200">
            Continue
          </button>
        ) : visibleStatus !== "loading" ? (
          <Link to="/login" className="mt-8 inline-flex min-h-12 items-center rounded-xl bg-red-700 px-7 py-3 font-bold text-white hover:bg-red-800">
            Go to login
          </Link>
        ) : null}
      </section>
    </main>
  );
}

export default VerifyEmail;
