import React from "react";
import { FaWhatsapp } from "react-icons/fa";
import { RiMessage2Fill } from "react-icons/ri";
import { TbWorld } from "react-icons/tb";
import { FaMicrophone } from "react-icons/fa6"; // 🎤 Voice bubble
import { LuMessageCircle } from "react-icons/lu";
import { useNavigate } from "react-router-dom";

const WA_NUMBER: string =
  (import.meta as any).env?.VITE_WA_NUMBER || "14155238886";
const WA_JOIN: string =
  (import.meta as any).env?.VITE_WA_JOIN_CODE || "";
const SMS_NUMBER: string =
  (import.meta as any).env?.VITE_SMS_NUMBER || "15551234567";

const FloatingWidget: React.FC = () => {
  const [open, setOpen] = React.useState(false);
  const navigate = useNavigate();

  const openWhatsApp = () => {
    const url = `https://wa.me/${WA_NUMBER}${
      WA_JOIN ? `?text=${encodeURIComponent(WA_JOIN)}` : ""
    }`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const openSMS = () => {
    window.location.href = `sms:+${SMS_NUMBER}`;
  };

  const openLiveChat = () => {
    navigate("/chat");
    setOpen(false);
  };

  const openVoice = () => {
    navigate("/voice");   // <-- Navigate to voice page
    setOpen(false);
  };

  return (
    <div className="fab" aria-live="polite">
      {open && (
        <div className="fab-menu">
          <div style={{ position: "relative" }}>
            <button className="fab-item fab-wa" onClick={openWhatsApp} aria-label="WhatsApp">
              <FaWhatsapp />
            </button>
            <span className="fab-label">WhatsApp Business</span>
          </div>

          <div style={{ position: "relative" }}>
            <button className="fab-item fab-sms" onClick={openSMS} aria-label="SMS">
              <RiMessage2Fill />
            </button>
            <span className="fab-label">SMS Support</span>
          </div>

          <div style={{ position: "relative" }}>
            <button className="fab-item fab-live" onClick={openLiveChat} aria-label="Live Chat">
              <TbWorld />
            </button>
            <span className="fab-label">Live Web Chat</span>
          </div>

          <div style={{ position: "relative" }}>
            <button className="fab-item fab-voice" onClick={openVoice} aria-label="Voice">
              <FaMicrophone />
            </button>
            <span className="fab-label">Voice Assistant</span>
          </div>

          <button className="fab-item fab-close" onClick={() => setOpen(false)} aria-label="Close">
            ✕
          </button>
        </div>
      )}

      <button className="fab-main" onClick={() => setOpen((o) => !o)} aria-label="Open widget">
        <LuMessageCircle />
      </button>
    </div>
  );
};

export default FloatingWidget;
