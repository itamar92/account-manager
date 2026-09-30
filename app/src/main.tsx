import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import { AuthProvider } from './AuthContext';
import { Layout } from './Layout';
import { Login } from './pages/Login';
import { Inbox } from './pages/Inbox';
import { Dashboard } from './pages/Dashboard';
import { Clients } from './pages/Clients';
import { Works } from './pages/Works';
import { Invoices } from './pages/Invoices';
import { Expenses } from './pages/Expenses';
import { Reports } from './pages/Reports';
import { Moonlight } from './pages/Moonlight';
import { ShowDetail } from './pages/moonlight/ShowDetail';
import { QuoteEditor } from './pages/moonlight/QuoteEditor';
import { Settings } from './pages/Settings';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            {/* What is unfinished is the landing page; the year's figures are one click over. */}
            <Route path="/" element={<Inbox />} />
            <Route path="/overview" element={<Dashboard />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/works" element={<Works />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/reports" element={<Reports />} />
            {/* The Moonlight tabs are routes so the sidebar can point straight at one. */}
            <Route path="/moonlight" element={<Moonlight />} />
            {/* Before /:tab, so "shows/<id>" is a show and not a tab named "shows". */}
            <Route path="/moonlight/shows/:id" element={<ShowDetail />} />
            <Route path="/moonlight/quotes/:id" element={<QuoteEditor />} />
            <Route path="/moonlight/:tab" element={<Moonlight />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>
);
