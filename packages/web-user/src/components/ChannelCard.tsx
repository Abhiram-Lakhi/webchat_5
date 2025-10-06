// packages/web-user/src/components/ChannelCard.tsx
import React from "react";

type Props = {
  icon: React.ReactNode;
  title: string;
  text: string;
  badgeClass: "badge-wa" | "badge-sms" | "badge-live" | "badge-voice";
  onClick?: () => void;
};

const ChannelCard: React.FC<Props> = ({
  icon,
  title,
  text,
  badgeClass,
  onClick,
}) => {
  // Make the whole card clickable if onClick is provided, with proper a11y.
  const clickableProps = onClick
    ? {
        role: "button" as const,
        tabIndex: 0,
        onClick,
        onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        },
        style: { cursor: "pointer" } as React.CSSProperties,
        "aria-label": title,
      }
    : {};

  return (
    <div className="card" {...clickableProps}>
      <div className={`iconBadge ${badgeClass}`}>{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
};

export default ChannelCard;
