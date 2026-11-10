import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { preservePendingProductRedirect } from "@/lib/pendingProductAction";
import { savePendingGuestCartAddForVerification } from "@/lib/pendingGuestCartAdd";
import FullAddressField from "@/components/FullAddressField";
import { isValidStreetAddress, normalizeFullAddress } from "@/lib/fullAddressValidation";
import { getPasswordStrength, isPasswordPolicySatisfied, PASSWORD_POLICY_HINT, PASSWORD_POLICY_MESSAGE } from "@/lib/passwordStrength";
import { getPhilippinePhoneError, isValidPhilippinePhone, normalizePhoneInput } from "@/lib/phoneValidation";
import logo from "../../assets/images/ACGCLOGO1.png";
import {
  AtSign,
  Building2,
  Eye,
  EyeOff,
  Hash,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MapPin,
  Phone,
  UserRound,
} from "lucide-react";
import LegalDocumentModal from "@/components/legal/LegalDocumentModal";
import { CURRENT_LEGAL_DOCUMENT_VERSIONS, getCurrentLegalDocument } from "../../../shared/legalDocuments.js";

function Signup() {
  const navigate = useNavigate();
  const location = useLocation();
  const { register, authError, setAuthError, adminExists, adminLoading } = useAuth();
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    email: "",
    username: "",
    street_address: "",
    city: "",
    province: "",
    zip_code: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(true);
  const [showTerms, setShowTerms] = useState(false);
  const passwordStrength = getPasswordStrength(formData.password);

  useEffect(() => {
    if (!adminLoading && adminExists === false) navigate("/", { replace: true });
  }, [adminExists, adminLoading, navigate]);

  useEffect(() => {
    if (!showPrivacyPolicy && !showTerms) return undefined;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setShowPrivacyPolicy(false);
        setShowTerms(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [showPrivacyPolicy, showTerms]);

  const sanitizeFieldValue = (name, value) => {
    if (name === "phone") return normalizePhoneInput(value);

    if (["first_name", "last_name", "city", "province"].includes(name)) {
      return value.replace(/[^\p{L}\s'-]/gu, "");
    }

    if (name === "zip_code") {
      return value.replace(/\D/g, "").slice(0, 4);
    }

    return value;
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((current) => ({
      ...current,
      [name]: sanitizeFieldValue(name, value),
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    setAuthError("");

    if (submitting) return;

    if (!privacyAcknowledged) {
      setError("Please read and acknowledge the Privacy Policy before registering.");
      return;
    }

    if (!acceptedTerms) {
      setError("Please agree to the Terms and Conditions before registering.");
      return;
    }

    if (formData.phone && !isValidPhilippinePhone(formData.phone)) {
      setError(getPhilippinePhoneError(formData.phone));
      return;
    }

    if (Object.values(formData).some((value) => !value)) {
      setError("Please complete all required fields.");
      return;
    }

    if (!isValidStreetAddress(formData.street_address)) {
      setError("Street address cannot exceed 100 characters.");
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!isPasswordPolicySatisfied(formData.password)) {
      setError(PASSWORD_POLICY_MESSAGE);
      return;
    }

    try {
      setSubmitting(true);
      const response = await register({
        first_name: formData.first_name,
        last_name: formData.last_name,
        email: formData.email,
        username: formData.username,
        street_address: normalizeFullAddress(formData.street_address),
        city: formData.city,
        province: formData.province,
        zip_code: formData.zip_code,
        phone: formData.phone,
        password: formData.password,
        privacy_policy_acknowledged: true,
        privacy_policy_version: CURRENT_LEGAL_DOCUMENT_VERSIONS.privacyPolicy,
        terms_and_conditions_accepted: true,
        terms_and_conditions_version: CURRENT_LEGAL_DOCUMENT_VERSIONS.termsAndConditions,
      });
      if (response?.success !== true || !response.email) {
        throw new Error(response?.message || "Unable to confirm that the verification email was sent. Please try again.");
      }
      preservePendingProductRedirect(location.state?.from, response.email);
      const pendingCartAdd = location.state?.pendingCartAdd
        ? { ...location.state.pendingCartAdd, registeredEmail: response.email }
        : undefined;
      if (pendingCartAdd) savePendingGuestCartAddForVerification(pendingCartAdd, response.email);
      navigate("/login", {
        replace: true,
        state: {
          from: location.state?.from,
          pendingProductEmail: location.state?.from ? response.email : undefined,
          pendingCartAdd,
          registrationNotice: {
            registeredEmail: response.email,
          },
        },
      });
    } catch (err) {
      setError(err.data?.message || err.message || "Sign up failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = "w-full rounded-xl border border-gray-300 py-2 pr-4 outline-none transition focus:border-red-500 focus:ring-4 focus:ring-red-500/10";

  return (
    <div className="auth-light-canvas flex h-[100dvh] min-h-[100dvh] items-stretch justify-center overflow-hidden lg:items-center lg:px-4 lg:py-5">
      <div className="relative z-10 grid h-full w-full max-w-none grid-rows-[minmax(10rem,30dvh)_minmax(0,1fr)] overflow-hidden bg-white lg:h-[calc(100dvh-2rem)] lg:max-h-[calc(100dvh-2rem)] lg:max-w-6xl lg:grid-cols-5 lg:grid-rows-1 lg:rounded-[20px] lg:border lg:border-gray-800 lg:shadow-[0_24px_70px_rgba(2,6,23,0.6)]">
        <div className="relative flex min-h-0 flex-col items-center justify-center gap-2 overflow-hidden bg-gradient-to-br from-slate-950 via-[#111827] to-[#450a0a] p-4 text-white sm:gap-3 lg:col-span-2 lg:p-8">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(148,163,184,.08),transparent_42%,rgba(127,29,29,.28))]" />
          <div className="pointer-events-none absolute -right-28 -top-20 h-80 w-80 rounded-full border border-white/10" />
          <div className="pointer-events-none absolute -right-16 -top-8 h-56 w-56 rounded-full border border-white/10" />
          <div className="relative z-10 text-center">
            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.28em] text-red-100 sm:text-xs lg:mb-6 lg:tracking-[0.3em]">Welcome To</p>
            <img src={logo} alt="ACGC" className="mx-auto mb-2 w-28 drop-shadow-[0_0_4px_rgba(255,255,255,0.7)] sm:mb-3 sm:w-36 lg:w-56" />
            <p className="mx-auto max-w-sm text-[11px] font-medium leading-4 text-red-50 sm:text-xs lg:text-sm lg:leading-6">Securely manage products, site inspections, and operations from one powerful dashboard.</p>
          </div>
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden bg-white px-4 py-2 text-slate-900 sm:px-6 lg:col-span-3 lg:p-5">
          {privacyAcknowledged ? (
          <>
          <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">Create your ACGC account</h1>
            <p className="mt-1 text-xs leading-5 text-gray-500">Verify your email to activate your profile.</p>

            <form className="mt-3 flex min-h-0 flex-1 flex-col lg:mt-4" onSubmit={handleSubmit}>
              {error || authError ? <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error || authError}</div> : null}
              {success ? <div className="mb-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-700">{success}</div> : null}

              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="grid gap-1.5 md:grid-cols-2">
                <Field icon={UserRound} label="First Name *" name="first_name" maxLength={50} value={formData.first_name} onChange={handleChange} placeholder="Enter your first name" inputClass={inputClass} />
                <Field icon={UserRound} label="Last Name *" name="last_name" maxLength={50} value={formData.last_name} onChange={handleChange} placeholder="Enter your last name" inputClass={inputClass} />
                <Field icon={Mail} label="Email *" type="email" name="email" value={formData.email} onChange={handleChange} placeholder="Enter your email" inputClass={inputClass} />
                <Field icon={AtSign} label="Username *" name="username" minLength={6} maxLength={12} pattern="[A-Za-z0-9._-]{6,12}" title="Use 6-12 letters, numbers, dots, underscores, or hyphens." value={formData.username} onChange={handleChange} placeholder="Choose a username" inputClass={inputClass} />
              </div>

              <div className="mt-1.5"><FullAddressField minimumLength={0} icon={MapPin} label="Street Address *" name="street_address" value={formData.street_address} onChange={handleChange} placeholder="Enter your street address" className={inputClass} /></div>
              <div className="mt-1.5 grid gap-1.5 md:grid-cols-2">
                <Field icon={Building2} label="City *" name="city" maxLength={40} value={formData.city} onChange={handleChange} placeholder="Enter your city" inputClass={inputClass} />
                <Field icon={MapPin} label="Province *" name="province" maxLength={40} value={formData.province} onChange={handleChange} placeholder="Enter your province" inputClass={inputClass} />
                <Field icon={Hash} label="Zip Code *" name="zip_code" inputMode="numeric" maxLength={4} value={formData.zip_code} onChange={handleChange} placeholder="4000" inputClass={inputClass} />
                <Field icon={Phone} label="Phone Number *" name="phone" type="tel" inputMode="tel" maxLength={13} value={formData.phone} onChange={handleChange} placeholder="+639171234567 or 09171234567" inputClass={inputClass} />
              </div>
              <div className="mt-1.5 grid gap-1.5 md:grid-cols-2">
                <div>
                  <Field
                    icon={LockKeyhole}
                    label="Password *"
                    type={showPassword ? "text" : "password"}
                    name="password"
                    minLength={8}
                    maxLength={128}
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="Enter your password"
                    inputClass={inputClass}
                    showPasswordToggle
                    passwordVisible={showPassword}
                    onToggleVisibility={() => setShowPassword((visible) => !visible)}
                  />
                  {formData.password ? (
                    <div className="mt-2" aria-live="polite">
                      <div
                        className="h-1.5 w-3/4 overflow-hidden rounded-full bg-slate-200"
                        role="progressbar"
                        aria-label="Password strength"
                        aria-valuemin="0"
                        aria-valuemax="4"
                        aria-valuenow={passwordStrength.score}
                      >
                        <div
                          className="h-full rounded-full transition-all duration-500 ease-out"
                          style={{
                            width: `${passwordStrength.score * 25}%`,
                            backgroundColor: passwordStrength.color,
                          }}
                        />
                      </div>
                      <p className="mt-1 text-xs font-semibold" style={{ color: passwordStrength.color }}>
                        {passwordStrength.label} password
                      </p>
                    </div>
                  ) : null}
                  <p className="mt-1 text-[11px] leading-4 text-slate-500">
                    {PASSWORD_POLICY_HINT}
                  </p>
                </div>
                <div>
                  <Field
                    icon={LockKeyhole}
                    label="Confirm Password *"
                    type={showConfirmPassword ? "text" : "password"}
                    name="confirmPassword"
                    minLength={8}
                    maxLength={128}
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    placeholder="Confirm your password"
                    inputClass={inputClass}
                    showPasswordToggle
                    passwordVisible={showConfirmPassword}
                    onToggleVisibility={() => setShowConfirmPassword((visible) => !visible)}
                    isValid={formData.confirmPassword.length > 0 && formData.password === formData.confirmPassword}
                  />
                  {formData.confirmPassword ? (
                    <p className={`mt-2 text-xs font-semibold ${formData.password === formData.confirmPassword ? "text-green-600" : "text-red-600"}`} role="status">
                      {formData.password === formData.confirmPassword ? "Passwords match" : "Passwords do not match"}
                    </p>
                  ) : null}
                </div>
              </div>

              </div>

              <div className="shrink-0 bg-white pt-2">
              <div className="mb-2 flex items-start gap-2 text-xs leading-5 text-slate-700 sm:text-sm">
                <input
                  id="accept-terms"
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(event) => setAcceptedTerms(event.target.checked)}
                  aria-label="I have read and agree to the Terms and Conditions."
                  className="mt-0.5 h-4 w-4 shrink-0 accent-red-700"
                />
                <div className="min-w-0 flex-1">
                  <label htmlFor="accept-terms">I have read and agree to the</label>{" "}
                  <button
                    type="button"
                    onClick={() => setShowTerms(true)}
                    className="font-semibold text-red-700 underline underline-offset-2 hover:text-red-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                  >
                    Terms and Conditions
                  </button>
                  .
                </div>
              </div>
              <button type="submit" disabled={submitting || !acceptedTerms} aria-busy={submitting} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-brand px-4 py-2 text-base font-bold text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
                {submitting ? <><LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> Sending verification email...</> : "Verify Email"}
              </button>
              <div className="mt-1.5 flex min-h-9 w-full flex-wrap items-center justify-center gap-1.5 rounded-xl border border-red-100 bg-red-50 px-3 py-1.5 text-xs text-slate-600 sm:text-sm">
                <span>Already have an account?</span>
                <Link to="/login" className="font-bold text-brand transition-opacity hover:opacity-80">Login</Link>
              </div>
              </div>
            </form>
          </div>
          </>
          ) : (
            <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col justify-center">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-700">Before you register</p>
              <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">Review the Privacy Policy</h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Read ACGC’s Privacy Notice to understand what customer and project information this system collects and how it is used. The registration form will open after you acknowledge the notice.
              </p>
              <button
                type="button"
                onClick={() => setShowPrivacyPolicy(true)}
                className="mt-6 min-h-11 w-full rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              >
                Read Privacy Policy
              </button>
              <div className="mt-4 flex flex-wrap justify-center gap-2 text-sm text-slate-600">
                <span>Already have an account?</span>
                <Link to="/login" className="font-bold text-brand underline-offset-2 hover:underline">Login</Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {showPrivacyPolicy ? (
        <LegalDocumentModal
          document={getCurrentLegalDocument("privacyPolicy")}
          documentType="privacyPolicy"
          onClose={() => setShowPrivacyPolicy(false)}
          onAcknowledge={() => {
            setPrivacyAcknowledged(true);
            setShowPrivacyPolicy(false);
          }}
        />
      ) : null}
      {showTerms ? (
        <LegalDocumentModal
          document={getCurrentLegalDocument("termsAndConditions")}
          documentType="termsAndConditions"
          onClose={() => setShowTerms(false)}
        />
      ) : null}
    </div>
  );
}

function Field({ label, inputClass, icon: Icon, showPasswordToggle = false, passwordVisible = false, onToggleVisibility, isValid = false, ...props }) {
  return (
    <label className="block text-xs font-semibold text-slate-700">
      <span className="mb-1 block">{label}</span>
      <span className="relative block">
        <Icon
          size={18}
          strokeWidth={1.8}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <input {...props} className={`${inputClass} ${isValid ? "border-green-500 focus:border-green-500 focus:ring-green-500/10" : ""} ${showPasswordToggle ? "pr-11" : ""} pl-11`} />
        {showPasswordToggle ? (
          <button
            type="button"
            onClick={onToggleVisibility}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-red-700"
            aria-label={passwordVisible ? "Hide password" : "Show password"}
          >
            {passwordVisible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        ) : null}
      </span>
    </label>
  );
}

export default Signup;
