import React from "react";

type Props = {
  icon: React.ReactNode;
  title: string;
  text: string;
  badgeClass: "badge-wa" | "badge-sms" | "badge-live";
};
const ChannelCard: React.FC<Props> = ({ icon, title, text, badgeClass }) => (
  <div className="card">
    <div className={`iconBadge ${badgeClass}`}>{icon}</div>
    <h3>{title}</h3>
    <p>{text}</p>
  </div>
);
export default ChannelCard;
