import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { ExternalLink, ImageOff, RotateCcw, X } from "lucide-react";

export function Button({
  children,
  variant = "outline",
  className = "",
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost" | "danger";
}) {
  return (
    <button
      type="button"
      className={`button ${variant} ${className}`}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const prior = document.activeElement as HTMLElement | null;
    el.showModal();
    return () => {
      el.close();
      prior?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-heading">
        <h2 id="modal-title">{title}</h2>
        <Button
          variant="ghost"
          aria-label="关闭窗口"
          onClick={onClose}
          autoFocus
        >
          <X size={20} />
        </Button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function RemoteImage({ url, label }: { url: string; label: string }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    if (status !== "loading") return;
    const timer = setTimeout(() => setStatus("error"), 12000);
    return () => clearTimeout(timer);
  }, [status, attempt]);
  return (
    <figure className="question-image">
      {status === "error" ? (
        <div className="image-fallback">
          <ImageOff size={24} />
          <p>原图暂时无法加载</p>
          <span>可重试，或打开原图查看。</span>
          <Button
            onClick={() => {
              setStatus("loading");
              setAttempt((a) => a + 1);
            }}
          >
            <RotateCcw size={16} />
            重试图片
          </Button>
        </div>
      ) : (
        <>
          {status === "loading" && (
            <div className="image-loading" role="status">
              正在加载原题图片…
            </div>
          )}
          <button
            className="image-zoom"
            aria-label={`放大${label}`}
            onClick={() => setZoom(true)}
            hidden={status !== "loaded"}
          >
            <img
              key={attempt}
              src={url}
              alt={label}
              loading="lazy"
              referrerPolicy="no-referrer"
              onLoad={() => setStatus("loaded")}
              onError={() => setStatus("error")}
            />
          </button>
          {status === "loading" && (
            <img
              className="image-probe"
              key={attempt}
              src={url}
              alt=""
              referrerPolicy="no-referrer"
              onLoad={() => setStatus("loaded")}
              onError={() => setStatus("error")}
            />
          )}
        </>
      )}
      <figcaption>
        {label}
        <a href={url} target="_blank" rel="noopener noreferrer">
          打开原图
          <ExternalLink size={14} />
        </a>
      </figcaption>
      {zoom && (
        <Modal title={label} onClose={() => setZoom(false)}>
          <img
            className="zoomed-image"
            src={url}
            alt={label}
            referrerPolicy="no-referrer"
          />
        </Modal>
      )}
    </figure>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
