import React, { createContext, useState, useContext } from 'react';

const UserContext = createContext(null);

export const UserProvider = ({ children }) => {
  const [user, setUser] = useState({ role: 'USER' }); // Default role

  // In a real app, you'd fetch this from an API upon login
  const loginAsAdmin = () => setUser({ role: 'APP_ADMIN' });
  const logout = () => setUser({ role: 'USER' });

  const value = { user, loginAsAdmin, logout };

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
};
