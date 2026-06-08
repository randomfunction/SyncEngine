'use client';

import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

interface MermaidProps {
  chart: string;
}

export default function Mermaid({ chart }: MermaidProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      fontFamily: 'inherit',
    });

    const renderChart = async () => {
      if (containerRef.current) {
        try {
          const { svg } = await mermaid.render(`mermaid-${Math.random().toString(36).substring(7)}`, chart);
          setSvgContent(svg);
        } catch (error) {
          console.error("Mermaid parsing failed", error);
        }
      }
    };

    renderChart();
  }, [chart]);

  return (
    <div 
      ref={containerRef} 
      className="mermaid-container w-full h-full flex justify-center items-center p-4 overflow-auto"
      dangerouslySetInnerHTML={{ __html: svgContent }}
    />
  );
}
