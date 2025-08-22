import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import MainApp from './MainApp';
import TrainerMode from './TrainerMode';
import LogComparison from './LogComparison';


function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<MainApp />} />
        <Route path="/trainer" element={<TrainerMode />} />
        <Route path="/log-comparison" element={<LogComparison />} />

      </Routes>
    </Router>

    
  );
}

export default App;

