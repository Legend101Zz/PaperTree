// apps/web/src/components/reader/BookViewer.tsx
'use client';

import { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { useReaderStore } from '@/store/readerStore';
import { BookContent, BookSection, Highlight, Explanation } from '@/types';
import { Info, FileText, Sparkles, AlertTriangle } from 'lucide-react';

interface BookViewerProps {
    paperId: string;
    bookContent: BookContent;
    pageCount: number;
    highlights: Highlight[];
    explanations: Explanation[];
    onTextSelect: (text: string, sectionId: string, pdfPage: number) => void;
    onSectionVisible: (sectionId: string, pdfPages: number[]) => void;
    onFigureClick: (figureId: string, pdfPage: number) => void;
    onHighlightClick: (highlightId: string, position: { x: number; y: number }) => void;
    scrollToSectionId?: string | null;
}

// ============ HIGHLIGHT UTILITIES ============

/**
 * Extract plain ASCII text from a string (removes math symbols, special chars)
 * This helps match text that was selected with math symbols against rendered content
 */
function extractPlainText(text: string): string {
    return text
        // Remove common math Unicode symbols
        .replace(/[\u0370-\u03FF]/g, '') // Greek
        .replace(/[\u2200-\u22FF]/g, '') // Math operators  
        .replace(/[\u2100-\u214F]/g, '') // Letterlike
        .replace(/[\u1D400-\u1D7FF]/g, '') // Math alphanumeric
        .replace(/[𝑌𝑦𝑋𝑥𝑇𝑡𝑝𝑣′∏∑∫]/g, '') // Common math chars
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Extract the first N words of plain text for matching
 */
function extractLeadingWords(text: string, wordCount: number = 6): string {
    const plain = extractPlainText(text);
    const words = plain.split(/\s+/).filter(w => w.length > 2);
    return words.slice(0, wordCount).join(' ');
}

/**
 * Normalize text for comparison - very aggressive normalization
 */
function normalizeForMatch(text: string): string {
    return text
        .toLowerCase()
        .replace(/\s+/g, '')  // Remove ALL whitespace
        .replace(/[^\w]/g, '') // Keep only word characters
        .slice(0, 100); // Limit length for performance
}

/**
 * Find the best match position for highlight text in container
 * Returns the text node and position, or null if not found
 */
function findHighlightPosition(
    container: HTMLElement,
    searchText: string,
    sectionId?: string
): { node: Text; start: number; length: number } | null {
    // Strategy 1: Try to find exact leading plain text
    const leadingWords = extractLeadingWords(searchText, 8);
    if (leadingWords.length < 10) {
        // Too short, try more words
        const moreWords = extractLeadingWords(searchText, 15);
        if (moreWords.length >= 10) {
            const result = findTextInContainer(container, moreWords);
            if (result) return result;
        }
    } else {
        const result = findTextInContainer(container, leadingWords);
        if (result) return result;
    }

    // Strategy 2: Try first sentence/clause
    const firstClause = searchText.split(/[.,:;!?\n]/)[0]?.trim();
    if (firstClause && firstClause.length > 15) {
        const plainClause = extractPlainText(firstClause);
        if (plainClause.length > 10) {
            const result = findTextInContainer(container, plainClause);
            if (result) return result;
        }
    }

    // Strategy 3: Fuzzy match using normalized text
    const normalizedSearch = normalizeForMatch(searchText);
    if (normalizedSearch.length > 15) {
        const result = findNormalizedMatch(container, normalizedSearch);
        if (result) return result;
    }

    return null;
}

/**
 * Find text in container using simple substring match
 */
function findTextInContainer(
    container: HTMLElement,
    searchText: string
): { node: Text; start: number; length: number } | null {
    const searchLower = searchText.toLowerCase().replace(/\s+/g, ' ').trim();
    if (searchLower.length < 5) return null;

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            const parent = node.parentElement;
            // Skip already highlighted content and KaTeX internals
            if (parent?.closest('.highlight-mark, .highlight-wrapper')) {
                return NodeFilter.FILTER_REJECT;
            }
            // Don't skip KaTeX - we want to find text around it
            return NodeFilter.FILTER_ACCEPT;
        }
    });

    // Build combined text from all text nodes
    const textNodes: Array<{ node: Text; start: number; text: string }> = [];
    let combinedText = '';
    let node: Text | null;

    while ((node = walker.nextNode() as Text)) {
        const text = node.textContent || '';
        textNodes.push({
            node,
            start: combinedText.length,
            text
        });
        combinedText += text;
    }

    // Search in combined text
    const combinedLower = combinedText.toLowerCase().replace(/\s+/g, ' ');
    const index = combinedLower.indexOf(searchLower);

    if (index === -1) return null;

    // Find which text node contains the start
    let runningLength = 0;
    for (const item of textNodes) {
        const nodeEnd = runningLength + item.text.length;
        if (index >= runningLength && index < nodeEnd) {
            const localStart = index - runningLength;
            // Calculate how much of the match is in this node
            const availableLength = item.text.length - localStart;
            const matchLength = Math.min(searchLower.length, availableLength);

            return {
                node: item.node,
                start: localStart,
                length: matchLength
            };
        }
        runningLength = nodeEnd;
    }

    return null;
}

/**
 * Find match using heavily normalized text (last resort)
 */
function findNormalizedMatch(
    container: HTMLElement,
    normalizedSearch: string
): { node: Text; start: number; length: number } | null {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            const parent = node.parentElement;
            if (parent?.closest('.highlight-mark, .highlight-wrapper')) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        }
    });

    let combinedNormalized = '';
    const nodeMap: Array<{ node: Text; normStart: number; origLength: number }> = [];
    let node: Text | null;

    while ((node = walker.nextNode() as Text)) {
        const text = node.textContent || '';
        const normalized = normalizeForMatch(text);
        nodeMap.push({
            node,
            normStart: combinedNormalized.length,
            origLength: text.length
        });
        combinedNormalized += normalized;
    }

    // Try to find a substring match
    const searchSubstr = normalizedSearch.slice(0, 30);
    const index = combinedNormalized.indexOf(searchSubstr);

    if (index === -1) return null;

    // Find the node
    for (const item of nodeMap) {
        const nodeEnd = item.normStart + normalizeForMatch(item.node.textContent || '').length;
        if (index >= item.normStart && index < nodeEnd) {
            return {
                node: item.node,
                start: 0,
                length: Math.min(50, item.origLength) // Highlight a reasonable chunk
            };
        }
    }

    return null;
}

/**
 * Get theme-aware highlight colors
 * Each theme has distinct colors optimized for readability
 */
function getHighlightColors(theme: string, isActive: boolean) {
    const themes = {
        // Light mode: Classic yellow/amber - warm and familiar
        light: {
            bg: isActive
                ? 'linear-gradient(to bottom, rgba(253, 224, 71, 0.5), rgba(250, 204, 21, 0.4))'
                : 'linear-gradient(to bottom, rgba(254, 249, 195, 0.6), rgba(254, 240, 138, 0.5))',
            bgFallback: isActive ? 'rgba(250, 204, 21, 0.45)' : 'rgba(254, 240, 138, 0.45)',
            border: isActive ? '2px solid #eab308' : '1px solid rgba(202, 138, 4, 0.4)',
            shadow: isActive ? '0 2px 8px rgba(234, 179, 8, 0.35)' : 'none',
            badge: isActive ? '#2563eb' : '#ca8a04',
            badgeText: 'white',
            textColor: 'inherit'
        },
        // Dark mode: Soft teal/cyan glow - easy on eyes, high contrast
        dark: {
            bg: isActive
                ? 'linear-gradient(to bottom, rgba(34, 211, 238, 0.25), rgba(6, 182, 212, 0.2))'
                : 'linear-gradient(to bottom, rgba(103, 232, 249, 0.18), rgba(34, 211, 238, 0.12))',
            bgFallback: isActive ? 'rgba(34, 211, 238, 0.22)' : 'rgba(103, 232, 249, 0.15)',
            border: isActive ? '2px solid #22d3ee' : '1px solid rgba(34, 211, 238, 0.4)',
            shadow: isActive ? '0 2px 12px rgba(34, 211, 238, 0.3), 0 0 20px rgba(34, 211, 238, 0.1)' : '0 1px 4px rgba(34, 211, 238, 0.15)',
            badge: isActive ? '#06b6d4' : '#0891b2',
            badgeText: 'white',
            textColor: '#e0f7fa'
        },
        // Sepia mode: Warm terracotta/rust - complementary to paper tone
        sepia: {
            bg: isActive
                ? 'linear-gradient(to bottom, rgba(234, 88, 12, 0.25), rgba(194, 65, 12, 0.2))'
                : 'linear-gradient(to bottom, rgba(251, 146, 60, 0.22), rgba(249, 115, 22, 0.16))',
            bgFallback: isActive ? 'rgba(234, 88, 12, 0.22)' : 'rgba(251, 146, 60, 0.18)',
            border: isActive ? '2px solid #c2410c' : '1px solid rgba(194, 65, 12, 0.4)',
            shadow: isActive ? '0 2px 8px rgba(194, 65, 12, 0.25)' : 'none',
            badge: isActive ? '#c2410c' : '#ea580c',
            badgeText: 'white',
            textColor: 'inherit'
        }
    };

    return themes[theme as keyof typeof themes] || themes.light;
}

/**
 * Apply highlight styling to a text node
 */
function applyHighlightToNode(
    node: Text,
    start: number,
    length: number,
    highlightId: string,
    isActive: boolean,
    expCount: number,
    theme: string
): boolean {
    const content = node.textContent || '';
    if (start < 0 || start >= content.length) return false;

    const end = Math.min(start + length, content.length);
    const before = content.slice(0, start);
    const match = content.slice(start, end);
    const after = content.slice(end);

    if (!match.trim()) return false;

    const parent = node.parentNode;
    if (!parent) return false;

    const c = getHighlightColors(theme, isActive);

    const wrapper = document.createElement('span');
    wrapper.className = 'highlight-wrapper';
    wrapper.setAttribute('data-highlight-id', highlightId);
    wrapper.setAttribute('data-theme', theme);

    // Create the highlight mark
    const mark = document.createElement('mark');
    mark.setAttribute('data-highlight-id', highlightId);
    mark.className = `highlight-mark ${isActive ? 'active animate-pulse-once' : ''}`;
    mark.style.cssText = `
        background: ${c.bgFallback};
        background: ${c.bg};
        padding: 2px 3px;
        margin: 0 -1px;
        border-radius: 3px;
        cursor: pointer;
        transition: all 0.2s ease;
        border-bottom: ${c.border};
        box-shadow: ${c.shadow};
        color: ${c.textColor};
        text-decoration: none;
    `;
    mark.textContent = match;

    // Create badge showing explanation count
    const badge = document.createElement('span');
    badge.setAttribute('data-highlight-id', highlightId);
    badge.className = 'highlight-badge';
    badge.style.cssText = `
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 20px;
        height: 20px;
        padding: 0 5px;
        margin-left: 3px;
        border-radius: 10px;
        background: ${c.badge};
        color: ${c.badgeText};
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        vertical-align: middle;
        transition: all 0.2s ease;
        box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        ${isActive ? 'transform: scale(1.1);' : ''}
    `;
    badge.textContent = expCount > 0 ? String(expCount) : '💬';

    wrapper.appendChild(mark);
    wrapper.appendChild(badge);

    // Insert into DOM
    if (before) parent.insertBefore(document.createTextNode(before), node);
    parent.insertBefore(wrapper, node);
    if (after) parent.insertBefore(document.createTextNode(after), node);
    parent.removeChild(node);

    return true;
}

/**
 * Apply all highlights to the content
 */
function applyHighlights(
    container: HTMLElement,
    highlights: Highlight[],
    explanations: Explanation[],
    activeHighlightId: string | null,
    inlineHighlightId: string | null,
    theme: string
): number {
    // First, clear existing highlights
    container.querySelectorAll('.highlight-wrapper').forEach((el) => {
        const mark = el.querySelector('mark');
        const text = mark?.textContent || '';
        const parent = el.parentNode;
        if (parent) {
            parent.replaceChild(document.createTextNode(text), el);
            parent.normalize();
        }
    });

    let appliedCount = 0;

    // Sort by length descending to avoid nested highlight issues
    const sortedHighlights = [...highlights].sort(
        (a, b) => b.selected_text.length - a.selected_text.length
    );

    for (const highlight of sortedHighlights) {
        // Find the section element if section_id is available
        let searchContainer = container;
        if (highlight.section_id) {
            const sectionEl = container.querySelector(`[data-section-id="${highlight.section_id}"]`);
            if (sectionEl instanceof HTMLElement) {
                searchContainer = sectionEl;
            }
        }

        const position = findHighlightPosition(searchContainer, highlight.selected_text, highlight.section_id);

        if (position) {
            const isActive = activeHighlightId === highlight.id || inlineHighlightId === highlight.id;
            const expCount = explanations.filter(e => e.highlight_id === highlight.id).length;

            const success = applyHighlightToNode(
                position.node,
                position.start,
                position.length,
                highlight.id,
                isActive,
                expCount,
                theme
            );

            if (success) {
                appliedCount++;
                console.log(`[Highlight] Applied: "${highlight.selected_text.slice(0, 50)}..."`);
            }
        } else {
            console.warn(`[Highlight] Could not find: "${highlight.selected_text.slice(0, 50)}..."`);
        }
    }

    return appliedCount;
}

// ============ MERMAID COMPONENT ============

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
            } catch { if (!cancelled) setFailed(true); }
        })();
        return () => { cancelled = true; };
    }, [chart]);

    if (failed) return <pre className="my-4 p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs overflow-auto">{chart}</pre>;
    if (!svg) return <div className="my-4 p-4 text-center text-gray-400">Loading diagram...</div>;
    return <div className="my-6 flex justify-center" dangerouslySetInnerHTML={{ __html: svg }} />;
}

// ============ MAIN COMPONENT ============

export function BookViewer(props: BookViewerProps) {
    const {
        bookContent,
        highlights,
        explanations,
        onTextSelect,
        onSectionVisible,
        onFigureClick,
        onHighlightClick,
        scrollToSectionId,
    } = props;

    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
    const [highlightVersion, setHighlightVersion] = useState(0);

    const settings = useReaderStore((s) => s.settings);
    const activeHighlightId = useReaderStore((s) => s.activeHighlightId);
    const inlineExplanation = useReaderStore((s) => s.inlineExplanation);

    const sections = useMemo(() => bookContent?.sections || [], [bookContent]);

    // Apply highlights when data changes
    useEffect(() => {
        if (!contentRef.current) return;

        const bookHighlights = highlights.filter((h) => h.mode === 'book');

        if (bookHighlights.length === 0) {
            // Clear any existing highlights
            contentRef.current.querySelectorAll('.highlight-wrapper').forEach((el) => {
                const mark = el.querySelector('mark');
                const text = mark?.textContent || '';
                el.parentNode?.replaceChild(document.createTextNode(text), el);
            });
            return;
        }

        // Delay to ensure content is rendered
        const timer = setTimeout(() => {
            if (!contentRef.current) return;

            const count = applyHighlights(
                contentRef.current,
                bookHighlights,
                explanations,
                activeHighlightId,
                inlineExplanation.highlightId,
                settings.theme
            );

            console.log(`[Highlights] Applied ${count}/${bookHighlights.length}`);
        }, 200);

        return () => clearTimeout(timer);
    }, [highlights, explanations, activeHighlightId, inlineExplanation.highlightId, settings.theme, highlightVersion]);

    // Re-apply highlights when explanation count changes
    useEffect(() => {
        setHighlightVersion((v) => v + 1);
    }, [explanations.length]);

    // Handle clicks on highlights
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const highlightId = target.getAttribute('data-highlight-id');

            if (highlightId && (target.classList.contains('highlight-mark') || target.classList.contains('highlight-badge'))) {
                e.preventDefault();
                e.stopPropagation();
                const rect = target.getBoundingClientRect();
                onHighlightClick(highlightId, { x: rect.right + 10, y: rect.bottom + 5 });
            }
        };

        const container = contentRef.current;
        container?.addEventListener('click', handleClick);
        return () => container?.removeEventListener('click', handleClick);
    }, [onHighlightClick]);

    // Section visibility observer
    useEffect(() => {
        if (!containerRef.current || sections.length === 0) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries
                    .filter((e) => e.isIntersecting)
                    .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

                if (visible.length > 0) {
                    const sectionId = visible[0].target.getAttribute('data-section-id');
                    const pdfPages = visible[0].target.getAttribute('data-pdf-pages');
                    if (sectionId) {
                        onSectionVisible(sectionId, pdfPages ? JSON.parse(pdfPages) : [0]);
                    }
                }
            },
            { root: containerRef.current, threshold: [0, 0.1, 0.25, 0.5], rootMargin: '-15% 0px -65% 0px' }
        );

        setTimeout(() => {
            sectionRefs.current.forEach((el) => observer.observe(el));
        }, 200);

        return () => observer.disconnect();
    }, [sections, onSectionVisible]);

    // Scroll to section
    useEffect(() => {
        if (scrollToSectionId) {
            const el = sectionRefs.current.get(scrollToSectionId);
            el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, [scrollToSectionId]);

    // Handle text selection
    const handleMouseUp = useCallback(() => {
        if (inlineExplanation.isOpen) return;

        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;

        const text = selection.toString().trim();
        if (!text || text.length < 3) return;

        // Find the section this selection is in
        let sectionId = '';
        let pdfPage = 0;
        let el = selection.anchorNode?.nodeType === Node.TEXT_NODE
            ? selection.anchorNode.parentElement
            : selection.anchorNode as HTMLElement;

        while (el && el !== containerRef.current) {
            const id = el.getAttribute('data-section-id');
            if (id) {
                sectionId = id;
                try {
                    pdfPage = JSON.parse(el.getAttribute('data-pdf-pages') || '[0]')[0];
                } catch { }
                break;
            }
            el = el.parentElement;
        }

        onTextSelect(text, sectionId, pdfPage);
    }, [onTextSelect, inlineExplanation.isOpen]);

    // Theme colors
    const theme = useMemo(() => ({
        dark: {
            bg: 'bg-[#1a1a1a]',
            text: 'text-gray-200',
            heading: 'text-white',
            muted: 'text-gray-400',
            border: 'border-gray-700',
            card: 'bg-gray-800/50',
            code: 'bg-gray-800',
            // Highlight accent for dark mode is cyan
            accent: 'text-cyan-400',
            accentBg: 'bg-cyan-500/10',
            accentBorder: 'border-cyan-500/30'
        },
        sepia: {
            bg: 'bg-[#f4ecd8]',
            text: 'text-[#5c4b37]',
            heading: 'text-[#3d3225]',
            muted: 'text-[#8b7355]',
            border: 'border-[#d4c4a8]',
            card: 'bg-[#efe6d5]',
            code: 'bg-[#e8dcc8]',
            // Highlight accent for sepia mode is warm orange
            accent: 'text-orange-700',
            accentBg: 'bg-orange-500/10',
            accentBorder: 'border-orange-500/30'
        },
        light: {
            bg: 'bg-white',
            text: 'text-gray-700',
            heading: 'text-gray-900',
            muted: 'text-gray-500',
            border: 'border-gray-200',
            card: 'bg-gray-50',
            code: 'bg-gray-100',
            // Highlight accent for light mode is amber
            accent: 'text-amber-600',
            accentBg: 'bg-amber-500/10',
            accentBorder: 'border-amber-500/30'
        },
    }[settings.theme] || {
        bg: 'bg-white',
        text: 'text-gray-700',
        heading: 'text-gray-900',
        muted: 'text-gray-500',
        border: 'border-gray-200',
        card: 'bg-gray-50',
        code: 'bg-gray-100',
        accent: 'text-amber-600',
        accentBg: 'bg-amber-500/10',
        accentBorder: 'border-amber-500/30'
    }), [settings.theme]);

    const fontClass = {
        serif: 'font-serif',
        sans: 'font-sans',
        mono: 'font-mono'
    }[settings.fontFamily || 'serif'];

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
        h1: ({ children }: any) => <h1 className={`text-2xl font-bold ${theme.heading} mt-8 mb-4`}>{children}</h1>,
        h2: ({ children }: any) => <h2 className={`text-xl font-semibold ${theme.heading} mt-6 mb-3`}>{children}</h2>,
        h3: ({ children }: any) => <h3 className={`text-lg font-medium ${theme.heading} mt-5 mb-2`}>{children}</h3>,
        ul: ({ children }: any) => <ul className={`list-disc ml-6 mb-4 space-y-2 ${theme.text}`}>{children}</ul>,
        ol: ({ children }: any) => <ol className={`list-decimal ml-6 mb-4 space-y-2 ${theme.text}`}>{children}</ol>,
        blockquote: ({ children }: any) => <blockquote className={`border-l-4 ${theme.border} pl-4 my-4 italic ${theme.muted}`}>{children}</blockquote>,
    }), [theme]);

    // Render a section
    const renderSection = (section: BookSection, index: number) => {
        const currentSectionId = useReaderStore.getState().currentSectionId;
        const isActive = currentSectionId === section.id;
        const pdfPages = section.pdf_pages || [0];
        const sectionId = section.id || `section-${index}`;

        return (
            <section
                key={sectionId}
                ref={(el) => { if (el) sectionRefs.current.set(sectionId, el); }}
                data-section-id={sectionId}
                data-pdf-pages={JSON.stringify(pdfPages)}
                className={`mb-8 scroll-mt-20 transition-all rounded-lg ${isActive ? `ring-2 ring-blue-400/50 ${theme.card} p-5 -mx-2` : 'p-2'
                    }`}
            >
                <div className={`flex items-center gap-3 mb-4 pb-3 border-b ${theme.border}`}>
                    <h2
                        className={`font-semibold ${theme.heading} flex-1`}
                        style={{ fontSize: `${1.4 - ((section.level || 1) - 1) * 0.1}rem` }}
                    >
                        {section.title || `Section ${index + 1}`}
                    </h2>
                    <button
                        onClick={() => onFigureClick('', pdfPages[0])}
                        className={`text-xs ${theme.muted} ${theme.card} px-2 py-1 rounded-md 
                            hover:bg-blue-100 dark:hover:bg-blue-900/30 border ${theme.border} 
                            flex items-center gap-1 transition-colors`}
                    >
                        <FileText className="w-3 h-3" /> p.{pdfPages[0] + 1}
                    </button>
                </div>
                <div className="section-content prose-content">
                    <ReactMarkdown
                        remarkPlugins={[remarkMath, remarkGfm]}
                        rehypePlugins={[rehypeKatex]}
                        components={mdComponents}
                    >
                        {section.content || ''}
                    </ReactMarkdown>
                </div>
            </section>
        );
    };

    // Empty state
    if (!bookContent || sections.length === 0) {
        return (
            <div className={`flex-1 flex items-center justify-center ${theme.bg}`}>
                <div className="text-center p-8">
                    <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
                    <h2 className={`text-lg font-semibold ${theme.heading} mb-2`}>No Content</h2>
                    <p className={theme.muted}>Generate book content to start reading.</p>
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
                ref={contentRef}
                className={`book-content ${fontClass} mx-auto px-6 md:px-12 py-8`}
                style={{
                    maxWidth: settings.pageWidth || 720,
                    fontSize: settings.fontSize || 18,
                    lineHeight: settings.lineHeight || 1.8
                }}
            >
                {/* Header */}
                <header className="mb-10 text-center">
                    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full 
                        ${theme.card} ${theme.muted} text-sm mb-4 border ${theme.border}`}>
                        <Sparkles className="w-4 h-4 text-blue-500" /> AI-Generated Explanation
                    </div>
                    <h1 className={`text-2xl md:text-3xl font-bold ${theme.heading} mb-4`}>
                        {bookContent.title || 'Untitled'}
                    </h1>
                    {bookContent.authors && (
                        <p className={theme.muted}>{bookContent.authors}</p>
                    )}
                </header>

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

                {/* Sections */}
                {sections.map((section, index) => renderSection(section, index))}

                {/* Footer */}
                <footer className={`mt-12 pt-6 border-t ${theme.border} text-center`}>
                    <p className={`text-sm ${theme.muted}`}>
                        💡 Select text to ask AI questions. Click highlighted text to view explanations.
                    </p>
                </footer>

                <div className="h-24" />
            </article>
        </div>
    );
}