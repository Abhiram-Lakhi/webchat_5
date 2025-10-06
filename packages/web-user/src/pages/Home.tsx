import React from "react";
import { FaWhatsapp } from "react-icons/fa";
import { RiMessage2Fill } from "react-icons/ri";
import { TbWorld } from "react-icons/tb";
import { FaMicrophone } from "react-icons/fa6";
import { useNavigate } from "react-router-dom";        // ⬅️ add this
import ChannelCard from "../components/ChannelCard";
import FloatingWidget from "../components/FloatingWidget";

const Home: React.FC = () => {
  const navigate = useNavigate();                      // ⬅️ and this

  return (
    <>
      <div className="container">
        <header className="hero">
          <h1>Omni-Channel Communication Hub</h1>
          <p>
            Experience seamless customer support across multiple channels with
            our modern floating widget. Click the floating button in the
            bottom-right corner to get started.
          </p>
        </header>

        <section className="grid">
          <ChannelCard
            icon={<FaWhatsapp size={26} />}
            title="WhatsApp Business"
            text="Connect with customers on the world's most popular messaging platform"
            badgeClass="badge-wa"
          />
          <ChannelCard
            icon={<RiMessage2Fill size={26} />}
            title="SMS Support"
            text="Reach customers directly through text messages for urgent communications"
            badgeClass="badge-sms"
          />
          <ChannelCard
            icon={<TbWorld size={26} />}
            title="Live Web Chat"
            text="Provide instant support through your website's integrated chat system"
            badgeClass="badge-live"
          />
          <ChannelCard
            icon={<FaMicrophone size={26} />}
            title="Voice Assistant"
            text="Talk to our AI-powered voice agent for instant support"
            badgeClass="badge-voice"
            onClick={() => navigate("/voice")}          // now defined ✅
          />
        </section>

        <h2 className="section-title">How It Works</h2>
        <section className="steps">
          <div className="step">
            <div className="num">1</div>
            <div>Click the floating button</div>
          </div>
          <div className="step">
            <div className="num">2</div>
            <div>Choose WhatsApp, SMS, Live Chat, or Voice</div>
          </div>
          <div className="step">
            <div className="num">3</div>
            <div>Start the conversation instantly</div>
          </div>
          <div className="step">
            <div className="num">4</div>
            <div>Handoff to a human when needed</div>
          </div>
        </section>
      </div>

      <FloatingWidget />
    </>
  );
};

export default Home;
