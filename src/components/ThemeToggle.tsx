import { useApp } from "@/context/AppContext";
import { useEffect, useRef } from "react";
import "../styles/darkToggle.css";

 // vamos criar já já

export function AnimatedThemeToggle() {
  const { ui, toggleTheme } = useApp();
  const isDark = ui.theme === "dark";
  const btnRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLElement>(null);

  const handleToggle = () => { 
    toggleTheme(); // usa sua lógica atual

    if (!iconRef.current) return;
    iconRef.current.classList.add("animated");

    setTimeout(() => {
      iconRef.current?.classList.remove("animated");
    }, 500);
  };

  return (
    <div className="dark-toggle-wrapper">
      <div
        ref={btnRef}
        className={`btn ${isDark ? "darkmode" : ""}`}
        onClick={handleToggle}
      >
        <div className="btn__indicator">
          <div className="btn__icon-container">
            <i
              ref={iconRef}
              className={`btn__icon fa-solid ${isDark ? "fa-moon" : "fa-sun"}`}
            ></i>
          </div>
        </div>
      </div>
    </div>
  );
}
