import React from "react";
import { useAgent, Message, Conversation } from "../agent/AgentProvider";

const QuickButtons: React.FC<{ onPick:(t:string)=>void }> = ({ onPick }) => (
  <div className="quickRow">
    <button className="quick" onClick={()=>onPick("Hi! How can I help you today?")}>Greeting</button>
    <button className="quick" onClick={()=>onPick("I understand. Let me check that for you.")}>Acknowledgment</button>
    <button className="quick" onClick={()=>onPick("I've updated that for you. Anything else I can assist with?")}>Follow-up</button>
  </div>
);

// small util to render the same badge style as Sidebar
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

export const ChatPane: React.FC = () => {
  const { selected, messages, send, endNow, endAccept, endDecline, endRequests, closed } = useAgent();
  const [text, setText] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const msgs: Message[] = selected ? (messages[selected.sessionId] || []) : [];
  const isClosed = selected ? !!closed[selected.sessionId] : false;
  const endReqId = selected ? endRequests[selected.sessionId] : undefined;

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 999999, behavior: "smooth" });
  }, [msgs.length, selected?.sessionId]);

  if (!selected) {
    return <div style={{ display:"grid", placeItems:"center", height:"100%", color:"#6b7280" }}>Select a conversation from the left to begin</div>;
  }

  const onSend = () => {
    if (!text.trim()) return;
    send(selected.sessionId, text.trim());
    setText("");
  };

  return (
    <>
      <div className="chatHeader">
        <div style={{ width:36,height:36,borderRadius:"50%",background:"#eef2f7",display:"grid",placeItems:"center",fontWeight:700 }}>
          {selected.name.split(" ").map(s=>s[0]).join("").slice(0,2)}
        </div>
        <div style={{ fontWeight:600 }}>{selected.name}</div>

        {/* dynamic channel badge */}
        <ChannelBadge channel={selected.channel} />

        <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
          {!isClosed && <button className="filterBtn" onClick={()=>endNow(selected.sessionId)}>End chat</button>}
          {isClosed && <span className="badge orange">Closed</span>}
        </div>
      </div>

      {endReqId && !isClosed && (
        <div style={{ background:"#fff8e1", border:"1px solid #f0d58a", padding:8, borderRadius:6, margin:"8px 16px" }}>
          User requested to end this chat.
          <span style={{ display:"inline-flex", gap:8, marginLeft:8 }}>
            <button className="filterBtn" onClick={()=>endAccept(selected.sessionId)}>End now</button>
            <button className="filterBtn" onClick={()=>endDecline(selected.sessionId)}>Continue</button>
          </span>
        </div>
      )}

      <div className="chatScroll" ref={scrollRef}>
        {msgs.map(m => (
          <div key={m.id} className={`msg ${m.senderType === "agent" ? "agent" : "user"}`}>
            {m.text}
            <div style={{ fontSize:12, opacity:.7, marginTop:6 }}>
              {new Date(m.createdAt).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}
            </div>
          </div>
        ))}
      </div>

      <QuickButtons onPick={t=>setText(t)} />
      <div className="composer">
        <input
          placeholder={isClosed ? "Chat is closed" : "Type your message..."}
          value={text}
          onChange={e=>setText(e.target.value)}
          onKeyDown={e=>{ if (e.key === "Enter") onSend(); }}
          disabled={isClosed}
        />
        <button className="composeBtn" onClick={onSend} disabled={isClosed}>➤</button>
      </div>
    </>
  );
};
