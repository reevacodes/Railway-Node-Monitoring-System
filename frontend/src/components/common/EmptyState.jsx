import React from 'react';
import { Database, AlertCircle, Info } from 'lucide-react';

export const EmptyState = ({
  icon: Icon = Database,
  title = 'No records found',
  description = 'No data is currently recorded in the system.',
  action = null,
}) => {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <Icon size={32} />
      </div>
      <h4 className="empty-state-title">{title}</h4>
      <p className="empty-state-desc">{description}</p>
      {action && <div style={{ marginTop: '14px' }}>{action}</div>}
    </div>
  );
};

export default EmptyState;
