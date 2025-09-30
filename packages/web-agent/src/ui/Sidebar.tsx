import React from "react";
import { useAgent, Conversation } from "../agent/AgentProvider";

const ChannelBadge: React.FC<{ channel?: Conversation["channel"] }> = ({ channel }) => {
  const ch = (channel || "web").toLowerCase();
  const cls =
    ch === "whatsapp" ? "badge green" :
    ch === "sms"      ? "badge blue"  :
                        "badge purple";
  const label =
    ch === "whatsapp" ? "WhatsApp" :
    ch === "sms"      ? "SMS"       :
                        "Web Chat";
  return <span className={cls}>{label}</span>;
};

export const Sidebar: React.FC = () => {
  const { queue, active, selected, select, accept, closed } = useAgent();
  const [q, setQ] = React.useState("");

  const list: (Conversation & { waiting: boolean })[] = [
    ...queue.map(c => ({ ...c, waiting: true })),
    ...active.map(c => ({ ...c, waiting: false })),
  ].filter(c =>
    c.name.toLowerCase().includes(q.toLowerCase()) ||
    (c.lastText || "").toLowerCase().includes(q.toLowerCase())
  );

  return (
    <>
      <div className="searchRow">
        <input
          placeholder="Search conversations..."
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>

      <div className="filters">
        <button className="filterBtn">All Channels</button>
        <button className="filterBtn">All Status</button>
        <button className="filterBtn">Most Recent</button>
      </div>

      <div className="convList">
        {list.map(c => {
          const initials = c.name.split(" ").map(s => s[0]).join("").slice(0, 2) || "U";
          const isSelected = selected?.sessionId === c.sessionId;
          const isClosed = !!closed[c.sessionId];

          return (
            <div
              key={c.sessionId}
              className="convItem"
              style={{ background: isSelected ? "#eef5ff" : undefined }}
              onClick={() => select(c)}
            >
              <div className="avatar">{initials}</div>

              <div>
                <div className="convTitle">
                  <span
                    className="dot"
                    style={{ background: c.waiting ? "#f59e0b" : (isClosed ? "#9ca3af" : "#20c25e") }}
                  />
                  {c.name}
                </div>

                <div className="convSub" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {c.waiting ? (
                    <span className="badge orange">Waiting</span>
                  ) : isClosed ? (
                    <span className="badge">Closed</span>
                  ) : (
                    <span className="badge green">Active</span>
                  )}
                  <ChannelBadge channel={c.channel} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>
                    {c.lastText || ""}
                  </span>
                </div>
              </div>

              {c.waiting && c.handoffRequestId ? (
                <button
                  className="filterBtn"
                  onClick={(e) => {
                    e.stopPropagation();
                    accept(c.handoffRequestId!, c);
                  }}
                >
                  Accept
                </button>
              ) : (
                <div style={{ color: "#8a94a5", fontSize: 12 }}>
                  {c.waiting ? "" : (isClosed ? "closed" : "active")}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
};
