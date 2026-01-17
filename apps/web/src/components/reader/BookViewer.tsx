// apps/web/src/components/reader/BookViewer.tsx
'use client';

import { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { useReaderStore } from '@/store/readerStore';
import { BookContent, BookSection, SmartOutlineItem, Highlight } from '@/types';
import { Info, FileText, Sparkles, ChevronRight, AlertTriangle, ExternalLink } from 'lucide-react';

interface BookViewerProps {
    paperId: string;
    bookContent: BookContent;
    outline: SmartOutlineItem[];
    pageCount: number;
    highlights: Highlight[];
    onTextSelect: (text: string, sectionId: string, pdfPage: number) => void;
    onSectionVisible: (sectionId: string, pdfPages: number[]) => void;
    onFigureClick: (figureId: string, pdfPage: number) => void;
    scrollToSectionId?: string | null;
}

// Mermaid component with better error handling
function MermaidDiagram({ chart }: { chart: string }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [svg, setSvg] = useState<string>('');
    const [error, setError] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const renderAttempted = useRef(false);

    useEffect(() => {
        // Prevent double render
        if (renderAttempted.current) return;
        renderAttempted.current = true;

        const renderChart = async () => {
            if (typeof window === 'undefined') return;

            // Validate chart has content
            if (!chart || chart.trim().length < 10) {
                setError('Invalid diagram syntax');
                setIsLoading(false);
                return;
            }

            try {
                const mermaid = (await import('mermaid')).default;

                mermaid.initialize({
                    startOnLoad: false,
                    theme: 'neutral',
                    securityLevel: 'loose',
                    fontFamily: 'inherit',
                });

                const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

                // Clean up the chart - remove any problematic characters
                const cleanChart = chart
                    .trim()
                    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width characters
                    .replace(/\t/g, '  '); // Replace tabs with spaces

                const { svg: renderedSvg } = await mermaid.render(id, cleanChart);
                setSvg(renderedSvg);
                setError('');
            } catch (e: any) {
                console.error('Mermaid render error:', e);
                setError(e.message || 'Failed to render diagram');
            } finally {
                setIsLoading(false);
            }
        };

        // Small delay to ensure DOM is ready
        const timer = setTimeout(renderChart, 100);
        return () => clearTimeout(timer);
    }, [chart]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-8 bg-gray-50 dark:bg-gray-800/50 rounded-lg my-4">
                <div className="flex items-center gap-2 text-gray-500">
                    <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
                    <span className="text-sm">Rendering diagram...</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 my-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="flex items-start gap-2 text-gray-600 dark:text-gray-400">
                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-yellow-500" />
                    <div className="flex-1">
                        <p className="text-sm font-medium mb-2">Diagram Preview</p>
                        <pre className="text-xs bg-gray-100 dark:bg-gray-900 p-3 rounded overflow-auto max-h-40">
                            {chart}
                        </pre>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="my-6 flex justify-center overflow-auto bg-white dark:bg-gray-800/30 rounded-lg p-4"
            dangerouslySetInnerHTML={{ __html: svg }}
        />
    );
}

// Figure reference button
function FigureReference({
    figure,
    onClick
}: {
    figure: string;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            className="inline-flex items-center gap-1 px-2 py-1 mx-1 bg-blue-50 dark:bg-blue-900/30 
                 text-blue-600 dark:text-blue-400 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/50 
                 transition-colors text-sm font-medium border border-blue-200 dark:border-blue-800"
        >
            <FileText className="w-3.5 h-3.5" />
            {figure}
            <ExternalLink className="w-3 h-3" />
        </button>
    );
}

export function BookViewer({
    paperId,
    bookContent,
    outline,
    pageCount,
    highlights,
    onTextSelect,
    onSectionVisible,
    onFigureClick,
    scrollToSectionId,
}: BookViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
    const lastVisibleSection = useRef<string | null>(null);

    const settings = useReaderStore((state) => state.settings);
    const currentSectionId = useReaderStore((state) => state.currentSectionId);
    const activeHighlightId = useReaderStore((state) => state.activeHighlightId);

    const sections = useMemo(() => bookContent?.sections || [], [bookContent]);

    // Track visible section with IntersectionObserver
    useEffect(() => {
        if (!containerRef.current || sections.length === 0) return;

        const observer = new IntersectionObserver(
            (entries) => {
                // Find the most visible section
                let mostVisibleEntry: IntersectionObserverEntry | null = null;
                let maxRatio = 0;

                for (const entry of entries) {
                    if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
                        maxRatio = entry.intersectionRatio;
                        mostVisibleEntry = entry;
                    }
                }

                if (mostVisibleEntry) {
                    const sectionId = mostVisibleEntry.target.getAttribute('data-section-id');
                    const pdfPagesStr = mostVisibleEntry.target.getAttribute('data-pdf-pages');

                    if (sectionId && sectionId !== lastVisibleSection.current) {
                        lastVisibleSection.current = sectionId;
                        const pdfPages = pdfPagesStr ? JSON.parse(pdfPagesStr) : [0];
                        console.log('Section visible:', sectionId, 'pages:', pdfPages);
                        onSectionVisible(sectionId, pdfPages);
                    }
                }
            },
            {
                root: containerRef.current,
                threshold: [0.1, 0.3, 0.5, 0.7],
                rootMargin: '-10% 0px -10% 0px'
            }
        );

        // Observe all sections
        sectionRefs.current.forEach((el) => observer.observe(el));

        return () => observer.disconnect();
    }, [sections, onSectionVisible]);

    // Scroll to section
    useEffect(() => {
        if (scrollToSectionId) {
            const el = sectionRefs.current.get(scrollToSectionId);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    }, [scrollToSectionId]);

    // Handle text selection for highlighting
    const handleMouseUp = useCallback(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;

        const text = selection.toString().trim();
        if (!text || text.length < 3) return;

        // Find section
        let sectionId = '';
        let pdfPage = 0;

        const anchorNode = selection.anchorNode;
        if (anchorNode) {
            let element = anchorNode.parentElement;
            while (element && element !== containerRef.current) {
                const id = element.getAttribute('data-section-id');
                if (id) {
                    sectionId = id;
                    const pdfPagesStr = element.getAttribute('data-pdf-pages');
                    if (pdfPagesStr) {
                        try {
                            const pages = JSON.parse(pdfPagesStr);
                            pdfPage = pages[0] || 0;
                        } catch { }
                    }
                    break;
                }
                element = element.parentElement;
            }
        }

        // Get position for popup
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        console.log('Book selection:', { text, sectionId, pdfPage }); // Debug
        onTextSelect(text, sectionId, pdfPage);
    }, [onTextSelect]);

    // Theme classes
    const theme = useMemo(() => {
        switch (settings.theme) {
            case 'dark':
                return {
                    bg: 'bg-[#1a1a1a]',
                    text: 'text-gray-200',
                    heading: 'text-white',
                    muted: 'text-gray-400',
                    border: 'border-gray-700',
                    card: 'bg-gray-800/50',
                    code: 'bg-gray-800',
                    highlight: 'bg-yellow-500/30',
                };
            case 'sepia':
                return {
                    bg: 'bg-[#f4ecd8]',
                    text: 'text-[#5c4b37]',
                    heading: 'text-[#3d3225]',
                    muted: 'text-[#8b7355]',
                    border: 'border-[#d4c4a8]',
                    card: 'bg-[#efe6d5]',
                    code: 'bg-[#e8dcc8]',
                    highlight: 'bg-yellow-600/30',
                };
            default:
                return {
                    bg: 'bg-white',
                    text: 'text-gray-700',
                    heading: 'text-gray-900',
                    muted: 'text-gray-500',
                    border: 'border-gray-200',
                    card: 'bg-gray-50',
                    code: 'bg-gray-100',
                    highlight: 'bg-yellow-200/60',
                };
        }
    }, [settings.theme]);

    const fontClass = {
        serif: 'font-serif',
        sans: 'font-sans',
        mono: 'font-mono',
    }[settings.fontFamily || 'serif'];

    // Highlight text content
    const highlightContent = useCallback((content: string, sectionId: string): React.ReactNode => {
        const sectionHighlights = highlights.filter(h =>
            h.mode === 'book' && content.includes(h.selected_text)
        );

        if (sectionHighlights.length === 0) return content;

        let result: React.ReactNode[] = [];
        let lastIndex = 0;

        sectionHighlights.forEach((h, idx) => {
            const index = content.indexOf(h.selected_text, lastIndex);
            if (index === -1) return;

            // Add text before highlight
            if (index > lastIndex) {
                result.push(content.slice(lastIndex, index));
            }

            // Add highlighted text
            result.push(
                <mark
                    key={`${h.id}-${idx}`}
                    data-highlight-id={h.id}
                    className={`${theme.highlight} rounded px-0.5 cursor-pointer transition-all
                     ${activeHighlightId === h.id ? 'ring-2 ring-yellow-500' : ''}`}
                >
                    {h.selected_text}
                </mark>
            );

            lastIndex = index + h.selected_text.length;
        });

        // Add remaining text
        if (lastIndex < content.length) {
            result.push(content.slice(lastIndex));
        }

        return result.length > 0 ? result : content;
    }, [highlights, activeHighlightId, theme.highlight]);

    // Custom markdown components
    const markdownComponents = useMemo(() => ({
        code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            const lang = match?.[1];
            const codeString = String(children).replace(/\n$/, '');

            if (!inline && lang === 'mermaid') {
                return <MermaidDiagram chart={codeString} />;
            }

            if (inline) {
                return (
                    <code className={`px-1.5 py-0.5 rounded ${theme.code} text-sm font-mono`} {...props}>
                        {children}
                    </code>
                );
            }

            return (
                <pre className={`p-4 rounded-lg overflow-x-auto ${theme.code} my-4`}>
                    <code className="text-sm font-mono" {...props}>{children}</code>
                </pre>
            );
        },
        p: ({ children }: any) => (
            <p className={`mb-4 leading-relaxed ${theme.text}`}>{children}</p>
        ),
        h1: ({ children }: any) => (
            <h1 className={`text-2xl font-bold ${theme.heading} mt-8 mb-4`}>{children}</h1>
        ),
        h2: ({ children }: any) => (
            <h2 className={`text-xl font-semibold ${theme.heading} mt-6 mb-3`}>{children}</h2>
        ),
        h3: ({ children }: any) => (
            <h3 className={`text-lg font-medium ${theme.heading} mt-5 mb-2`}>{children}</h3>
        ),
        ul: ({ children }: any) => (
            <ul className={`list-disc ml-6 mb-4 space-y-2 ${theme.text}`}>{children}</ul>
        ),
        ol: ({ children }: any) => (
            <ol className={`list-decimal ml-6 mb-4 space-y-2 ${theme.text}`}>{children}</ol>
        ),
        li: ({ children }: any) => (
            <li className="leading-relaxed">{children}</li>
        ),
        blockquote: ({ children }: any) => (
            <blockquote className={`border-l-4 ${theme.border} pl-4 my-4 italic ${theme.muted}`}>
                {children}
            </blockquote>
        ),
        strong: ({ children }: any) => (
            <strong className="font-semibold">{children}</strong>
        ),
        em: ({ children }: any) => (
            <em className="italic">{children}</em>
        ),
        a: ({ href, children }: any) => (
            <a href={href} className="text-blue-500 hover:underline" target="_blank" rel="noopener noreferrer">
                {children}
            </a>
        ),
        table: ({ children }: any) => (
            <div className="overflow-x-auto my-4">
                <table className={`min-w-full border ${theme.border}`}>{children}</table>
            </div>
        ),
        th: ({ children }: any) => (
            <th className={`px-4 py-2 border ${theme.border} ${theme.card} font-semibold text-left`}>{children}</th>
        ),
        td: ({ children }: any) => (
            <td className={`px-4 py-2 border ${theme.border}`}>{children}</td>
        ),
    }), [theme]);

    const renderSection = (section: BookSection, index: number) => {
        const isActive = currentSectionId === section.id;
        const pdfPages = section.pdf_pages || [];
        const figures = section.figures || [];
        const sectionContent = section.content || '';
        const sectionTitle = section.title || `Section ${index + 1}`;
        const sectionLevel = section.level || 1;
        const sectionId = section.id || `section-${index}`;

        return (
            <section
                key={sectionId}
                ref={(el) => el && sectionRefs.current.set(sectionId, el)}
                data-section-id={sectionId}
                data-pdf-pages={JSON.stringify(pdfPages)}
                className={`mb-10 scroll-mt-20 transition-all duration-300 rounded-lg
                   ${isActive ? `ring-2 ring-blue-300 dark:ring-blue-700 ${theme.card} p-6 -mx-2` : 'p-2'}`}
            >
                {/* Section heading */}
                <div className={`flex items-center gap-3 mb-4 pb-3 border-b ${theme.border}`}>
                    <h2
                        className={`font-semibold ${theme.heading} flex-1`}
                        style={{ fontSize: `${1.4 - (sectionLevel - 1) * 0.12}rem` }}
                    >
                        {sectionTitle}
                    </h2>
                    {pdfPages.length > 0 && (
                        <button
                            onClick={() => onFigureClick('', pdfPages[0])}
                            className={`text-xs ${theme.muted} ${theme.card} px-2 py-1 rounded-md 
                         hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors
                         border ${theme.border}`}
                            title="View in PDF"
                        >
                            📄 p.{pdfPages[0] + 1}
                            {pdfPages.length > 1 && `-${pdfPages[pdfPages.length - 1] + 1}`}
                        </button>
                    )}
                </div>

                {/* Section content */}
                <div className="prose-content">
                    <ReactMarkdown
                        remarkPlugins={[remarkMath, remarkGfm]}
                        rehypePlugins={[rehypeKatex]}
                        components={markdownComponents}
                    >
                        {sectionContent}
                    </ReactMarkdown>
                </div>

                {/* Figure references */}
                {figures.length > 0 && (
                    <div className={`mt-6 p-4 rounded-lg ${theme.card} border ${theme.border}`}>
                        <span className={`text-sm font-medium ${theme.muted} block mb-2`}>
                            📊 Referenced in original paper:
                        </span>
                        <div className="flex flex-wrap gap-2">
                            {figures.map((fig, i) => {
                                const keyFig = bookContent.key_figures?.find(
                                    (kf) => kf.id === fig || kf.caption?.includes(fig)
                                );
                                return (
                                    <FigureReference
                                        key={i}
                                        figure={fig}
                                        onClick={() => onFigureClick(fig, keyFig?.pdf_page ?? pdfPages[0] ?? 0)}
                                    />
                                );
                            })}
                        </div>
                    </div>
                )}
            </section>
        );
    };

    if (!bookContent || sections.length === 0) {
        return (
            <div className={`flex-1 flex items-center justify-center ${theme.bg}`}>
                <div className="text-center p-8">
                    <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
                    <h2 className={`text-lg font-semibold ${theme.heading} mb-2`}>
                        No Content Available
                    </h2>
                    <p className={theme.muted}>
                        The book content could not be loaded. Try regenerating.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className={`flex-1 overflow-auto ${theme.bg}`}
            onMouseUp={handleMouseUp}
        >
            <article
                className={`book-content ${fontClass} mx-auto px-6 md:px-12 py-8`}
                style={{
                    maxWidth: settings.pageWidth || 720,
                    fontSize: settings.fontSize || 18,
                    lineHeight: settings.lineHeight || 1.8,
                }}
            >
                {/* Header */}
                <header className="mb-12 text-center">
                    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${theme.card} ${theme.muted} text-sm mb-4 border ${theme.border}`}>
                        <Sparkles className="w-4 h-4 text-blue-500" />
                        AI-Generated Explanation
                    </div>

                    <h1 className={`text-2xl md:text-3xl lg:text-4xl font-bold ${theme.heading} mb-4 leading-tight`}>
                        {bookContent.title || 'Untitled Paper'}
                    </h1>

                    {bookContent.authors && (
                        <p className={`${theme.muted} mb-6`}>{bookContent.authors}</p>
                    )}
                </header>

                {/* TL;DR Card */}
                {bookContent.tldr && (
                    <div className={`p-6 rounded-xl ${theme.card} border ${theme.border} mb-12`}>
                        <div className="flex items-center gap-2 mb-3">
                            <Info className="w-5 h-5 text-blue-500" />
                            <h2 className={`font-semibold ${theme.heading}`}>TL;DR</h2>
                        </div>
                        <p className={`${theme.text} leading-relaxed`}>{bookContent.tldr}</p>
                    </div>
                )}

                {/* Sections */}
                {sections.map((section, i) => renderSection(section, i))}

                {/* Footer */}
                <footer className={`mt-16 pt-8 border-t ${theme.border} text-center`}>
                    <p className={`text-sm ${theme.muted}`}>
                        💡 This is an AI-generated explanation to help you understand the paper.
                        <br />
                        Use the PDF preview on the right to see the original content and figures.
                    </p>
                </footer>

                <div className="h-32" />
            </article>
        </div>
    );
}