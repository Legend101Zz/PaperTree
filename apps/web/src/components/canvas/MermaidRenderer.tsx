// apps/web/src/components/canvas/MermaidRenderer.tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Code, Eye, RefreshCw } from 'lucide-react';

interface MermaidRendererProps {
    chart: string;
    className?: string;
}

export function MermaidRenderer({ chart, className = '' }: MermaidRendererProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [svg, setSvg] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showRaw, setShowRaw] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const renderChart = async () => {
            if (!chart?.trim()) {
                setError('No chart content');
                setIsLoading(false);
                return;
            }

            setIsLoading(true);
            setError(null);

            try {
                const mermaid = (await import('mermaid')).default;

                mermaid.initialize({
                    startOnLoad: false,
                    theme: 'neutral',
                    securityLevel: 'loose',
                    fontFamily: 'Inter, system-ui, sans-serif',
                    flowchart: {
                        useMaxWidth: true,
                        htmlLabels: true,
                        curve: 'basis',
                    },
                    sequence: {
                        useMaxWidth: true,
                        wrap: true,
                    },
                });

                const id = `mermaid-${Math.random().toString(36).slice(2, 11)}`;

                // Add timeout for rendering
                const renderPromise = mermaid.render(id, chart.trim());
                const timeoutPromise = new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('Render timeout')), 5000)
                );

                const { svg: renderedSvg } = await Promise.race([renderPromise, timeoutPromise]);

                if (!cancelled) {
                    setSvg(renderedSvg);
                    setIsLoading(false);
                }
            } catch (err: any) {
                if (!cancelled) {
                    console.error('Mermaid render error:', err);
                    setError(err.message || 'Failed to render diagram');
                    setIsLoading(false);
                }
            }
        };

        renderChart();

        return () => {
            cancelled = true;
        };
    }, [chart]);

    if (isLoading) {
        return (
            <div className={`flex items-center justify-center p-6 ${className}`}>
                <RefreshCw className="w-5 h-5 animate-spin text-gray-400" />
                <span className="ml-2 text-sm text-gray-500">Rendering diagram...</span>
            </div>
        );
    }

    if (error || showRaw) {
        return (
            <div className={`relative ${className}`}>
                {error && (
                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-sm mb-2 p-2 bg-amber-50 dark:bg-amber-900/20 rounded">
                        <AlertTriangle className="w-4 h-4" />
                        <span>{error}</span>
                    </div>
                )}
                <div className="relative">
                    <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded overflow-auto max-h-60 font-mono">
                        {chart}
                    </pre>
                    {!error && (
                        <button
                            onClick={() => setShowRaw(false)}
                            className="absolute top-2 right-2 p-1.5 bg-white dark:bg-gray-700 rounded shadow hover:bg-gray-50 dark:hover:bg-gray-600"
                            title="Show rendered"
                        >
                            <Eye className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className={`relative ${className}`}>
            <div
                ref={containerRef}
                className="mermaid-container flex justify-center overflow-auto"
                dangerouslySetInnerHTML={{ __html: svg }}
            />
            <button
                onClick={() => setShowRaw(true)}
                className="absolute top-2 right-2 p-1.5 bg-white/80 dark:bg-gray-700/80 rounded shadow hover:bg-white dark:hover:bg-gray-600 opacity-0 hover:opacity-100 transition-opacity"
                title="Show code"
            >
                <Code className="w-4 h-4" />
            </button>
        </div>
    );
}