// src/App.js
import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import MainApp from './MainApp';
import TrainerMode from './TrainerMode';
import LogComparison from './LogComparison';
import Portal from './Portal';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/trainer"        element={<TrainerMode />} />
        <Route path="/log-comparison" element={<LogComparison />} />
        <Route path="/portal"         element={<Portal />} />
        <Route path="*"               element={<MainApp />} />
      </Routes>
    </Router>
  );
}
