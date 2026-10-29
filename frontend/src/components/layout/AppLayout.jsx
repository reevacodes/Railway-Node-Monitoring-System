import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { useNetwork } from '../../context/NetworkContext';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';

export const AppLayout = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { notification } = useNetwork();

  return (
    <div className="app-shell">
      <Sidebar
        isCollapsed={isCollapsed}
        onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
      />

      <div className="main-wrapper">
        <Header />
        <main className="page-container">
          <Outlet />
        </main>
      </div>

      {/* Global Toast Notification */}
      {notification && (
        <div className="toast-container">
          <div className={`toast toast-${notification.type}`}>
            {notification.type === 'success' && <CheckCircle2 size={16} />}
            {notification.type === 'error' && <AlertCircle size={16} />}
            {notification.type === 'info' && <Info size={16} />}
            <span>{notification.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default AppLayout;
