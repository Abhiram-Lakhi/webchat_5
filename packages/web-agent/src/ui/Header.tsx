import React from "react";
import { useAgent } from "../agent/AgentProvider";

export const Header: React.FC = () => {
  const { queue, active } = useAgent();
  const total = queue.length + active.length;

  return (
    <header className="header">
      <div style={{ fontSize:22, fontWeight:800 }}>Call Center Dashboard</div>
      <span className="badge green">Connected</span>
      <div className="stats">
        <div className="stat"><div>Total</div><b>{total}</b></div>
        <div className="stat"><div style={{color:"#d97706"}}>Waiting</div><b>{queue.length}</b></div>
        <div className="stat"><div style={{color:"#16a34a"}}>Active</div><b>{active.length}</b></div>
        <div className="stat"><div>Avg Wait</div><b>{queue.length ? "31m" : "0m"}</b></div>
      </div>
    </header>
  );
};
