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
import { BandWorkspace } from './pages/BandWorkspace';
import { ShowDetail } from './pages/band/ShowDetail';
import { QuoteEditor } from './pages/band/QuoteEditor';
import { QuotePreview } from './pages/band/QuotePreview';
import { QuotePublic } from './pages/QuotePublic';
import { Settings } from './pages/Settings';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          {/* A client's quote link: no login and no shell — see server/publicQuotes.ts. */}
          <Route path="/q/:token" element={<QuotePublic />} />
          {/* Outside the shell: the quote on its own, the way the client will get it. */}
          <Route path="/band/quotes/:id/preview" element={<QuotePreview />} />
          <Route element={<Layout />}>
            {/* What is unfinished is the landing page; the year's figures are one click over. */}
            <Route path="/" element={<Inbox />} />
            <Route path="/overview" element={<Dashboard />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/works" element={<Works />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/reports" element={<Reports />} />
            {/* The band tabs are routes so the sidebar can point straight at one. */}
            <Route path="/band" element={<BandWorkspace />} />
            {/* Before /:tab, so "shows/<id>" is a show and not a tab named "shows". */}
            <Route path="/band/shows/:id" element={<ShowDetail />} />
            <Route path="/band/quotes/:id" element={<QuoteEditor />} />
            <Route path="/band/:tab" element={<BandWorkspace />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>
);
