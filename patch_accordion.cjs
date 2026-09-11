const fs = require('fs');
let code = fs.readFileSync('src/components/ScreenerDashboard.jsx', 'utf8');

// Update imports
code = code.replace(
  "import React, { useState, useEffect } from 'react';",
  "import React, { useState, useEffect, useRef } from 'react';"
);

// Replace state and toggleCard
code = code.replace(
  "const [expandedCards, setExpandedCards] = useState({});",
  `const [expandedCard, setExpandedCard] = useState(null);
  const gridRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (gridRef.current && !gridRef.current.contains(event.target)) {
        setExpandedCard(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);`
);

code = code.replace(
  "const toggleCard = (ticker) => setExpandedCards(prev => ({...prev, [ticker]: !prev[ticker]}));",
  "const toggleCard = (ticker) => setExpandedCard(prev => prev === ticker ? null : ticker);"
);

// Update grid container ref
code = code.replace(
  '<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-start">',
  '<div ref={gridRef} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-start">'
);

// Update usage in JSX
code = code.replace(
  /{expandedCards\[match.ticker\] \? <ChevronUp/g,
  '{expandedCard === match.ticker ? <ChevronUp'
);

code = code.replace(
  /{expandedCards\[match.ticker\] && \(/g,
  '{expandedCard === match.ticker && ('
);

fs.writeFileSync('src/components/ScreenerDashboard.jsx', code);
