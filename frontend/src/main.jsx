import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import App from './App.jsx';
import AuthTest from './pages/AuthTest.jsx';
import JjhTest from './pages/JjhTest.jsx';
import './index.css';

const root = createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/jjhtest" element={<JjhTest />} />
        <Route path="/auth-test" element={<AuthTest />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
