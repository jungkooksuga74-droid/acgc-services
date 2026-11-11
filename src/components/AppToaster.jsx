import { Toaster, ToastBar } from "react-hot-toast";
import { useIsMobile } from "@/hooks/useIsMobile";

export default function AppToaster({ position = "bottom-right", darkMode = false, zIndex = 9999 }) {
  const isMobile = useIsMobile();
  const toasterPosition = isMobile ? "top-center" : position;
  const containerStyle = {
    zIndex,
    ...(isMobile
      ? { top: "calc(env(safe-area-inset-top, 0px) + 72px)", left: 12, right: 12, bottom: 12 }
      : {}),
  };

  return (
    <Toaster
      position={toasterPosition}
      containerStyle={containerStyle}
      toastOptions={{
        duration: 4200,
        style: {
          minWidth: "min(290px, calc(100vw - 28px))",
          maxWidth: "min(360px, calc(100vw - 28px))",
          minHeight: "60px",
          padding: "11px 14px",
          borderRadius: "10px",
          border: "1px solid rgba(255,255,255,.14)",
          color: "#f8fafc",
          boxShadow: "0 12px 32px rgba(15,23,42,.28)",
          backdropFilter: "blur(12px)",
        },
        success: {
          style: {
            background: darkMode
              ? "linear-gradient(110deg, rgba(6,78,59,.96), rgba(49,46,87,.98))"
              : "linear-gradient(110deg, #0b6b55, #37315f)",
          },
          iconTheme: { primary: "#10d58a", secondary: "#073b36" },
        },
        error: {
          style: {
            background: darkMode
              ? "linear-gradient(110deg, rgba(116,27,61,.97), rgba(49,46,87,.98))"
              : "linear-gradient(110deg, #8b234a, #37315f)",
          },
          iconTheme: { primary: "#ff386c", secondary: "#52112f" },
        },
        loading: {
          style: {
            background: darkMode
              ? "linear-gradient(110deg, rgba(30,64,100,.97), rgba(49,46,87,.98))"
              : "linear-gradient(110deg, #245d86, #37315f)",
          },
        },
      }}
    >
      {(toast) => (
        <ToastBar
          toast={toast}
          style={{
            ...toast.style,
            gap: "10px",
            lineHeight: 1.35,
            fontSize: "13px",
            fontWeight: 600,
          }}
        />
      )}
    </Toaster>
  );
}
