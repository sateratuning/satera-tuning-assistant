// src/App.js
import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import MainApp from './MainApp';
import TrainerMode from './TrainerMode';
import LogComparison from './LogComparison';

export default function App() {
  return (
    <Router>
      <Routes>
        {/* specific routes first */}
        <Route path="/trainer" element={<TrainerMode />} />
        <Route path="/log-comparison" element={<LogComparison />} />
        {/* catch-all: "/" and everything else -> MainApp */}
        <Route path="*" element={<MainApp />} />
      </Routes>
    </Router>
  );
}
