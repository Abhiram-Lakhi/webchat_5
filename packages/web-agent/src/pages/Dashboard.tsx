import React from "react";
import { Header } from "../ui/Header";
import { Sidebar } from "../ui/Sidebar";
import { ChatPane } from "../ui/ChatPane";

const Dashboard: React.FC = () => (
  <div className="layout">
    <Header />
    <aside className="sidebar"><Sidebar /></aside>
    <main className="main"><ChatPane /></main>
  </div>
);
export default Dashboard;
