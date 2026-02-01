// apps/web/src/components/reader/BookViewer.tsx
'use client';

import { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { useReaderStore, BookViewMode } from '@/store/readerStore';
import { BookContent, PageSummary, Highlight, Explanation } from '@/types';
import {
    Info, FileText, Sparkles, AlertTriangle, Loader2,
    ChevronRight, ChevronLeft, ChevronDown, BookOpen, Lightbulb, Plus,
    Layers, BookOpenCheck, ArrowLeft, ArrowRight
} from 'lucide-react';

interface BookViewerProps {
    paperId: string;
    bookContent: BookContent;
    pageCount: number;
    highlights: Highlight[];
    explanations: Explanation[];
    onTextSelect: (text: string, sectionId: string, pdfPage: number) => void;
    onPageVisible: (pageNum: number) => void;
    onFigureClick: (figureId: string, pdfPage: number) => void;
    onHighlightClick: (highlightId: string, position: { x: number; y: number }) => void;
    onGenerateMorePages: (pages: number[]) => void;
    scrollToPage?: number | null;
}

// ============ MERMAID ============

function MermaidDiagram({ chart }: { chart: string }) {
    const [svg, setSvg] = useState('');
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!chart?.trim()) { setFailed(true); return; }
            try {
                const m = (await import('mermaid')).default;
                m.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
                const { svg: s } = await Promise.race([
                    m.render(`m-${Math.random().toString(36).slice(2)}`, chart.trim()),
                    new Promise<never>((_, rej) => setTimeout(() => rej('timeout'), 4000))
                ]);
                if (!cancelled) setSvg(s);
            } catch {
                if (!cancelled) setFailed(true);
            }
        })();
        return () => { cancelled = true; };
    }, [chart]);

    if (failed) return <pre className="my-4 p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs overflow-auto">{chart}</pre>;
    if (!svg) return <div className="my-4 p-4 text-center text-gray-400 flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Rendering...</div>;
    return <div className="my-6 flex justify-center overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />;
}

// ============ PAGE CONTENT ============

interface PageContentProps {
    summary: PageSummary;
    pageNum: number;
    totalPages: number;
    theme: any;
    mdComponents: any;
    onFigureClick: (page: number) => void;
    compact?: boolean;
}

function PageContent({ summary, pageNum, totalPages, theme, mdComponents, onFigureClick, compact }: PageContentProps) {
    const hasContent = summary.summary && !summary.summary.includes('could not be summarized') && !summary.summary.includes('appears empty');

    return (
        <div className={compact ? '' : 'px-5 py-4'}>
            {/* Key concepts */}
            {summary.key_concepts && summary.key_concepts.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-4">
                    {summary.key_concepts.map((concept, i) => (
                        <span key={i} className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full ${theme.accentBg} ${theme.accent}`}>
                            <Lightbulb className="w-3 h-3" />
                            {concept}
                        </span>
                    ))}
                </div>
            )}

            {/* Content */}
            {hasContent ? (
                <div className={`prose-content ${theme.text}`}>
                    <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]} components={mdComponents}>
                        {summary.summary}
                    </ReactMarkdown>
                </div>
            ) : (
                <div className={`text-center py-8 ${theme.muted}`}>
                    <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No explanation available for this page.</p>
                    <button
                        onClick={() => onFigureClick(pageNum)}
                        className={`mt-3 text-sm ${theme.accent} hover:underline`}
                    >
                        View original PDF page →
                    </button>
                </div>
            )}
        </div>
    );
}

// ============ SCROLL MODE PAGE CARD ============

interface ScrollPageCardProps {
    summary: PageSummary;
    pageNum: number;
    totalPages: number;
    isVisible: boolean;
    theme: any;
    mdComponents: any;
    onFigureClick: (page: number) => void;
    onRef: (el: HTMLElement | null) => void;
}

function ScrollPageCard({ summary, pageNum, totalPages, isVisible, theme, mdComponents, onFigureClick, onRef }: ScrollPageCardProps) {
    const [expanded, setExpanded] = useState(true);

    return (
        <section
            ref={onRef}
            data-page={pageNum}
            className={`mb-8 scroll-mt-20 transition-all rounded-xl border ${isVisible ? `${theme.activeBorder} ${theme.card} shadow-md` : `${theme.border} bg-transparent`}`}
        >
            <div className={`flex items-center gap-3 px-5 py-4 border-b ${theme.border} cursor-pointer`} onClick={() => setExpanded(!expanded)}>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    {expanded ? <ChevronDown className={`w-4 h-4 ${theme.muted}`} /> : <ChevronRight className={`w-4 h-4 ${theme.muted}`} />}
                    <h2 className={`font-semibold ${theme.heading} truncate`}>{summary.title}</h2>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    {summary.has_math && <span className={`text-xs px-2 py-0.5 rounded-full ${theme.card} ${theme.muted}`}>Math</span>}
                    {summary.has_figures && <span className={`text-xs px-2 py-0.5 rounded-full ${theme.card} ${theme.muted}`}>Figures</span>}
                    <button
                        onClick={(e) => { e.stopPropagation(); onFigureClick(pageNum); }}
                        className={`text-xs px-2 py-1 rounded-md ${theme.card} ${theme.muted} hover:bg-blue-100 dark:hover:bg-blue-900/30 border ${theme.border} flex items-center gap-1`}
                    >
                        <FileText className="w-3 h-3" />Page {pageNum + 1}
                    </button>
                </div>
            </div>
            {expanded && <PageContent summary={summary} pageNum={pageNum} totalPages={totalPages} theme={theme} mdComponents={mdComponents} onFigureClick={onFigureClick} />}
        </section>
    );
}

// ============ FLIP MODE ============

interface FlipModeProps {
    pageSummaries: PageSummary[];
    pageCount: number;
    currentPage: number;
    onPageChange: (page: number) => void;
    theme: any;
    mdComponents: any;
    onFigureClick: (page: number) => void;
    onGenerateMorePages: (pages: number[]) => void;
    generatingPages: Set<number>;
}

function FlipMode({ pageSummaries, pageCount, currentPage, onPageChange, theme, mdComponents, onFigureClick, onGenerateMorePages, generatingPages }: FlipModeProps) {
    const summaryMap = useMemo(() => new Map(pageSummaries.map(s => [s.page, s])), [pageSummaries]);
    const currentSummary = summaryMap.get(currentPage);
    const isGenerating = generatingPages.has(currentPage);

    const goNext = useCallback(() => {
        if (currentPage < pageCount - 1) onPageChange(currentPage + 1);
    }, [currentPage, pageCount, onPageChange]);

    const goPrev = useCallback(() => {
        if (currentPage > 0) onPageChange(currentPage - 1);
    }, [currentPage, onPageChange]);

    // Keyboard navigation
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goNext();
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') goPrev();
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [goNext, goPrev]);

    return (
        <div className="flex flex-col h-full">
            {/* Page indicator */}
            <div className={`flex items-center justify-between px-6 py-3 border-b ${theme.border} ${theme.card}`}>
                <button
                    onClick={goPrev}
                    disabled={currentPage === 0}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg ${theme.text} disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors`}
                >
                    <ArrowLeft className="w-4 h-4" />
                    <span className="hidden sm:inline">Previous</span>
                </button>

                <div className="flex items-center gap-3">
                    <span className={`text-sm font-medium ${theme.heading}`}>
                        Page {currentPage + 1} of {pageCount}
                    </span>
                    <div className="flex gap-1">
                        {Array.from({ length: Math.min(pageCount, 10) }, (_, i) => {
                            const page = pageCount <= 10 ? i : Math.floor(i * pageCount / 10);
                            const isActive = page === currentPage;
                            const hasContent = summaryMap.has(page);
                            return (
                                <button
                                    key={i}
                                    onClick={() => onPageChange(page)}
                                    className={`w-2 h-2 rounded-full transition-all ${isActive ? 'bg-blue-500 scale-125' : hasContent ? theme.accent.replace('text-', 'bg-').replace('-600', '-300').replace('-400', '-600') : 'bg-gray-300 dark:bg-gray-600'}`}
                                />
                            );
                        })}
                    </div>
                </div>

                <button
                    onClick={goNext}
                    disabled={currentPage >= pageCount - 1}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg ${theme.text} disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors`}
                >
                    <span className="hidden sm:inline">Next</span>
                    <ArrowRight className="w-4 h-4" />
                </button>
            </div>

            {/* Page content */}
            <div className="flex-1 overflow-auto">
                <div className="max-w-3xl mx-auto px-6 py-8">
                    {currentSummary ? (
                        <div className={`rounded-xl border ${theme.border} ${theme.card} overflow-hidden`}>
                            <div className={`px-5 py-4 border-b ${theme.border}`}>
                                <h2 className={`text-xl font-semibold ${theme.heading}`}>{currentSummary.title}</h2>
                                <div className="flex items-center gap-3 mt-2">
                                    {currentSummary.has_math && <span className={`text-xs px-2 py-0.5 rounded-full ${theme.accentBg} ${theme.accent}`}>Contains Math</span>}
                                    {currentSummary.has_figures && <span className={`text-xs px-2 py-0.5 rounded-full ${theme.accentBg} ${theme.accent}`}>Has Figures</span>}
                                    <button
                                        onClick={() => onFigureClick(currentPage)}
                                        className={`text-xs ${theme.accent} hover:underline flex items-center gap-1`}
                                    >
                                        <FileText className="w-3 h-3" />View PDF
                                    </button>
                                </div>
                            </div>
                            <PageContent
                                summary={currentSummary}
                                pageNum={currentPage}
                                totalPages={pageCount}
                                theme={theme}
                                mdComponents={mdComponents}
                                onFigureClick={onFigureClick}
                            />
                        </div>
                    ) : isGenerating ? (
                        <div className={`rounded-xl border-2 border-dashed ${theme.border} p-12 text-center`}>
                            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-500" />
                            <p className={theme.muted}>Generating explanation for page {currentPage + 1}...</p>
                        </div>
                    ) : (
                        <div className={`rounded-xl border-2 border-dashed ${theme.border} p-12 text-center`}>
                            <Plus className={`w-10 h-10 mx-auto mb-4 ${theme.muted}`} />
                            <h3 className={`font-semibold ${theme.heading} mb-2`}>Page {currentPage + 1} not generated</h3>
                            <p className={`text-sm ${theme.muted} mb-4`}>Generate an AI explanation for this page.</p>
                            <button
                                onClick={() => onGenerateMorePages([currentPage])}
                                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium text-sm flex items-center gap-2 mx-auto"
                            >
                                <Sparkles className="w-4 h-4" />
                                Generate Page {currentPage + 1}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom nav hints */}
            <div className={`px-6 py-2 border-t ${theme.border} text-center text-xs ${theme.muted}`}>
                Use ← → arrow keys to navigate • Click page dots to jump
            </div>
        </div>
    );
}

// ============ GENERATE MORE CARD ============

interface GenerateMoreCardProps {
    remainingPages: number[];
    totalPages: number;
    generatingPages: Set<number>;
    onGenerate: (pages: number[]) => void;
    theme: any;
}

function GenerateMoreCard({ remainingPages, totalPages, generatingPages, onGenerate, theme }: GenerateMoreCardProps) {
    const isGenerating = remainingPages.some(p => generatingPages.has(p));
    const nextBatch = remainingPages.slice(0, 5);

    return (
        <div className={`rounded-xl border-2 border-dashed ${theme.border} p-8 text-center`}>
            <Plus className={`w-12 h-12 ${theme.muted} mx-auto mb-4`} />
            <h3 className={`font-semibold ${theme.heading} mb-2`}>
                {remainingPages.length} more page{remainingPages.length !== 1 ? 's' : ''} available
            </h3>
            <p className={`text-sm ${theme.muted} mb-4`}>
                Pages {remainingPages.map(p => p + 1).slice(0, 5).join(', ')}
                {remainingPages.length > 5 && ` and ${remainingPages.length - 5} more`}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                    onClick={() => onGenerate(nextBatch)}
                    disabled={isGenerating}
                    className="px-4 py-2 rounded-lg font-medium text-sm bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-50 flex items-center justify-center gap-2"
                >
                    {isGenerating ? <><Loader2 className="w-4 h-4 animate-spin" />Generating...</> : <><Sparkles className="w-4 h-4" />Generate next {nextBatch.length}</>}
                </button>
                {remainingPages.length > 5 && (
                    <button
                        onClick={() => onGenerate(remainingPages)}
                        disabled={isGenerating}
                        className={`px-4 py-2 rounded-lg font-medium text-sm ${theme.card} ${theme.text} border ${theme.border} hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 flex items-center justify-center gap-2`}
                    >
                        Generate all {remainingPages.length}
                    </button>
                )}
            </div>
        </div>
    );
}

// ============ MAIN COMPONENT ============

export function BookViewer(props: BookViewerProps) {
    const { bookContent, pageCount, highlights, explanations, onTextSelect, onPageVisible, onFigureClick, onHighlightClick, onGenerateMorePages, scrollToPage } = props;

    const containerRef = useRef<HTMLDivElement>(null);
    const pageRefs = useRef<Map<number, HTMLElement>>(new Map());

    const settings = useReaderStore((s) => s.settings);
    const visiblePage = useReaderStore((s) => s.visiblePage);
    const currentBookPage = useReaderStore((s) => s.currentBookPage);
    const generatingPages = useReaderStore((s) => s.generatingPages);
    const inlineExplanation = useReaderStore((s) => s.inlineExplanation);
    const setBookViewMode = useReaderStore((s) => s.setBookViewMode);
    const setCurrentBookPage = useReaderStore((s) => s.setCurrentBookPage);

    const viewMode = settings.bookViewMode || 'scroll';

    const pageSummaries = useMemo(() => bookContent?.page_summaries || [], [bookContent]);
    const summaryStatus = bookContent?.summary_status;
    const generatedPages = new Set(summaryStatus?.generated_pages || pageSummaries.map(p => p.page));

    const remainingPages = useMemo(() => {
        const all = Array.from({ length: pageCount }, (_, i) => i);
        return all.filter(p => !generatedPages.has(p));
    }, [pageCount, generatedPages]);

    // Theme
    const theme = useMemo(() => ({
        dark: { bg: 'bg-[#1a1a1a]', text: 'text-gray-200', heading: 'text-white', muted: 'text-gray-400', border: 'border-gray-700', activeBorder: 'border-cyan-500/50', card: 'bg-gray-800/50', code: 'bg-gray-800', accent: 'text-cyan-400', accentBg: 'bg-cyan-500/10' },
        sepia: { bg: 'bg-[#f4ecd8]', text: 'text-[#5c4b37]', heading: 'text-[#3d3225]', muted: 'text-[#8b7355]', border: 'border-[#d4c4a8]', activeBorder: 'border-orange-500/50', card: 'bg-[#efe6d5]', code: 'bg-[#e8dcc8]', accent: 'text-orange-700', accentBg: 'bg-orange-500/10' },
        light: { bg: 'bg-white', text: 'text-gray-700', heading: 'text-gray-900', muted: 'text-gray-500', border: 'border-gray-200', activeBorder: 'border-blue-500/50', card: 'bg-gray-50', code: 'bg-gray-100', accent: 'text-blue-600', accentBg: 'bg-blue-500/10' },
    }[settings.theme] || { bg: 'bg-white', text: 'text-gray-700', heading: 'text-gray-900', muted: 'text-gray-500', border: 'border-gray-200', activeBorder: 'border-blue-500/50', card: 'bg-gray-50', code: 'bg-gray-100', accent: 'text-blue-600', accentBg: 'bg-blue-500/10' }), [settings.theme]);

    const fontClass = { serif: 'font-serif', sans: 'font-sans', mono: 'font-mono' }[settings.fontFamily || 'serif'];

    // Markdown components
    const mdComponents = useMemo(() => ({
        code({ inline, className, children }: any) {
            const lang = /language-(\w+)/.exec(className || '')?.[1];
            const code = String(children).replace(/\n$/, '');
            if (!inline && lang === 'mermaid') return <MermaidDiagram chart={code} />;
            if (inline) return <code className={`px-1.5 py-0.5 rounded ${theme.code} text-sm font-mono`}>{children}</code>;
            return <pre className={`p-4 rounded-lg overflow-x-auto ${theme.code} my-4`}><code className="text-sm font-mono">{children}</code></pre>;
        },
        p: ({ children }: any) => <p className={`mb-4 leading-relaxed ${theme.text}`}>{children}</p>,
        h1: ({ children }: any) => <h1 className={`text-xl font-bold ${theme.heading} mt-6 mb-3`}>{children}</h1>,
        h2: ({ children }: any) => <h2 className={`text-lg font-semibold ${theme.heading} mt-5 mb-2`}>{children}</h2>,
        h3: ({ children }: any) => <h3 className={`text-base font-medium ${theme.heading} mt-4 mb-2`}>{children}</h3>,
        ul: ({ children }: any) => <ul className={`list-disc ml-6 mb-4 space-y-1.5 ${theme.text}`}>{children}</ul>,
        ol: ({ children }: any) => <ol className={`list-decimal ml-6 mb-4 space-y-1.5 ${theme.text}`}>{children}</ol>,
        blockquote: ({ children }: any) => <blockquote className={`border-l-4 ${theme.activeBorder} pl-4 my-4 italic ${theme.muted} ${theme.card} py-2 pr-4 rounded-r-lg`}>{children}</blockquote>,
        strong: ({ children }: any) => <strong className={`font-semibold ${theme.heading}`}>{children}</strong>,
    }), [theme]);

    // Scroll mode: page visibility observer
    useEffect(() => {
        if (viewMode !== 'scroll' || !containerRef.current || pageSummaries.length === 0) return;
        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
                if (visible.length > 0) {
                    const pageNum = parseInt(visible[0].target.getAttribute('data-page') || '0');
                    onPageVisible(pageNum);
                }
            },
            { root: containerRef.current, threshold: [0, 0.25, 0.5], rootMargin: '-10% 0px -70% 0px' }
        );
        setTimeout(() => { pageRefs.current.forEach(el => observer.observe(el)); }, 100);
        return () => observer.disconnect();
    }, [pageSummaries, onPageVisible, viewMode]);

    // Scroll to page
    useEffect(() => {
        if (viewMode === 'scroll' && scrollToPage !== null && scrollToPage !== undefined) {
            const el = pageRefs.current.get(scrollToPage);
            el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (viewMode === 'flip' && scrollToPage !== null && scrollToPage !== undefined) {
            setCurrentBookPage(scrollToPage);
        }
    }, [scrollToPage, viewMode, setCurrentBookPage]);

    // Text selection
    const handleMouseUp = useCallback(() => {
        if (inlineExplanation.isOpen) return;
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;
        const text = selection.toString().trim();
        if (!text || text.length < 3) return;

        let pageNum = viewMode === 'flip' ? currentBookPage : 0;
        if (viewMode === 'scroll') {
            let el = selection.anchorNode?.nodeType === Node.TEXT_NODE ? selection.anchorNode.parentElement : selection.anchorNode as HTMLElement;
            while (el && el !== containerRef.current) {
                const page = el.getAttribute('data-page');
                if (page !== null) { pageNum = parseInt(page); break; }
                el = el.parentElement;
            }
        }
        onTextSelect(text, `page-${pageNum}`, pageNum);
    }, [onTextSelect, inlineExplanation.isOpen, viewMode, currentBookPage]);

    // Empty state
    if (!bookContent || pageSummaries.length === 0) {
        return (
            <div className={`flex-1 flex items-center justify-center ${theme.bg}`}>
                <div className="text-center p-8">
                    <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
                    <h2 className={`text-lg font-semibold ${theme.heading} mb-2`}>No Content Yet</h2>
                    <p className={theme.muted}>Generate book content to start reading.</p>
                </div>
            </div>
        );
    }

    return (
        <div ref={containerRef} className={`flex-1 flex flex-col overflow-hidden ${theme.bg}`} onMouseUp={handleMouseUp}>
            {/* Mode toggle header */}
            <div className={`flex items-center justify-between px-4 py-2 border-b ${theme.border} ${theme.card}`}>
                <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-blue-500" />
                    <span className={`text-sm font-medium ${theme.heading}`}>{bookContent.title}</span>
                    <span className={`text-xs ${theme.muted}`}>• {pageSummaries.length}/{pageCount} pages</span>
                </div>
                <div className="flex items-center gap-1 p-1 rounded-lg bg-gray-100 dark:bg-gray-800">
                    <button
                        onClick={() => setBookViewMode('scroll')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${viewMode === 'scroll' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'hover:bg-gray-200 dark:hover:bg-gray-700'} ${theme.text}`}
                    >
                        <Layers className="w-4 h-4" />
                        <span className="hidden sm:inline">Scroll</span>
                    </button>
                    <button
                        onClick={() => setBookViewMode('flip')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${viewMode === 'flip' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'hover:bg-gray-200 dark:hover:bg-gray-700'} ${theme.text}`}
                    >
                        <BookOpenCheck className="w-4 h-4" />
                        <span className="hidden sm:inline">Pages</span>
                    </button>
                </div>
            </div>

            {/* Content area */}
            {viewMode === 'flip' ? (
                <FlipMode
                    pageSummaries={pageSummaries}
                    pageCount={pageCount}
                    currentPage={currentBookPage}
                    onPageChange={(p) => { setCurrentBookPage(p); onPageVisible(p); }}
                    theme={theme}
                    mdComponents={mdComponents}
                    onFigureClick={(page) => onFigureClick('', page)}
                    onGenerateMorePages={onGenerateMorePages}
                    generatingPages={generatingPages}
                />
            ) : (
                <div className="flex-1 overflow-auto">
                    <article className={`book-content ${fontClass} mx-auto px-6 md:px-12 py-8`} style={{ maxWidth: settings.pageWidth || 720, fontSize: settings.fontSize || 18, lineHeight: settings.lineHeight || 1.8 }}>
                        {/* TL;DR */}
                        {bookContent.tldr && (
                            <div className={`p-5 rounded-xl ${theme.card} border ${theme.border} mb-10`}>
                                <div className="flex items-center gap-2 mb-2">
                                    <Info className="w-5 h-5 text-blue-500" />
                                    <h2 className={`font-semibold ${theme.heading}`}>TL;DR</h2>
                                </div>
                                <p className={`${theme.text} leading-relaxed`}>{bookContent.tldr}</p>
                            </div>
                        )}

                        {/* Pages */}
                        {pageSummaries.sort((a, b) => a.page - b.page).map((summary) => (
                            <ScrollPageCard
                                key={summary.page}
                                summary={summary}
                                pageNum={summary.page}
                                totalPages={pageCount}
                                isVisible={visiblePage === summary.page}
                                theme={theme}
                                mdComponents={mdComponents}
                                onFigureClick={(page) => onFigureClick('', page)}
                                onRef={(el) => { if (el) pageRefs.current.set(summary.page, el); }}
                            />
                        ))}

                        {/* Generate more */}
                        {remainingPages.length > 0 && (
                            <GenerateMoreCard remainingPages={remainingPages} totalPages={pageCount} generatingPages={generatingPages} onGenerate={onGenerateMorePages} theme={theme} />
                        )}

                        <div className="h-24" />
                    </article>
                </div>
            )}
        </div>
    );
}