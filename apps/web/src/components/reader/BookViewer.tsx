'use client';

import { useCallback, useRef, useEffect } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { Highlight, OutlineItem } from '@/types';
import { getTextContext } from '@/lib/utils';

interface BookViewerProps {
    text: string;
    outline: OutlineItem[];
    highlights: Highlight[];
    onTextSelect: (text: string, anchor: {
        exact: string;
        prefix: string;
        suffix: string;
        section_path: string[];
    }) => void;
}

export function BookViewer({ text, outline, highlights, onTextSelect }: BookViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { settings, activeHighlightId } = useReaderStore();

    // Apply highlights to text
    const renderTextWithHighlights = useCallback(() => {
        if (!text) return null;

        const bookHighlights = highlights.filter(h => h.mode === 'book');

        // Sort highlights by position in text
        const sortedHighlights = bookHighlights
            .map(h => ({
                ...h,
                index: text.indexOf(h.selected_text)
            }))
            .filter(h => h.index !== -1)
            .sort((a, b) => a.index - b.index);

        if (sortedHighlights.length === 0) {
            return <p style={{ whiteSpace: 'pre-wrap' }}>{text}</p>;
        }

        const elements: React.ReactNode[] = [];
        let lastIndex = 0;

        sortedHighlights.forEach((highlight, idx) => {
            // Add text before highlight
            if (highlight.index > lastIndex) {
                elements.push(
                    <span key={`text-${idx}`}>
                        {text.slice(lastIndex, highlight.index)}
                    </span>
                );
            }

            // Add highlighted text
            elements.push(
                <mark
                    key={`highlight-${highlight.id}`}
                    className={`book-highlight cursor-pointer ${activeHighlightId === highlight.id ? 'active' : ''
                        }`}
                    data-highlight-id={highlight.id}
                >
                    {highlight.selected_text}
                </mark>
            );

            lastIndex = highlight.index + highlight.selected_text.length;
        });

        // Add remaining text
        if (lastIndex < text.length) {
            elements.push(
                <span key="text-end">{text.slice(lastIndex)}</span>
            );
        }

        return <p style={{ whiteSpace: 'pre-wrap' }}>{elements}</p>;
    }, [text, highlights, activeHighlightId]);

    const handleTextSelection = useCallback(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;

        const selectedText = selection.toString().trim();
        if (!selectedText) return;

        // Get context
        const { prefix, suffix } = getTextContext(text, selectedText);

        // Find current section
        const sectionPath: string[] = [];
        const selectionStart = text.indexOf(selectedText);

        for (const item of outline) {
            if (item.start_idx <= selectionStart && item.end_idx >= selectionStart) {
                sectionPath.push(item.title);
            }
        }

        onTextSelect(selectedText, {
            exact: selectedText,
            prefix,
            suffix,
            section_path: sectionPath
        });
    }, [text, outline, onTextSelect]);

    // Scroll to active highlight
    useEffect(() => {
        if (activeHighlightId && containerRef.current) {
            const highlightEl = containerRef.current.querySelector(
                `[data-highlight-id="${activeHighlightId}"]`
            );
            if (highlightEl) {
                highlightEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, [activeHighlightId]);

    const themeStyles = {
        light: { backgroundColor: '#ffffff', color: '#1f2937' },
        dark: { backgroundColor: '#171717', color: '#f3f4f6' },
        sepia: { backgroundColor: '#f8f1e7', color: '#3b2b23' }
    };

    return (
        <div
            ref={containerRef}
            className="flex-1 overflow-auto p-8"
            style={themeStyles[settings.theme]}
            onMouseUp={handleTextSelection}
        >
            <div
                className="max-w-none mx-auto prose prose-lg"
                style={{
                    maxWidth: settings.pageWidth,
                    fontSize: settings.fontSize,
                    lineHeight: settings.lineHeight
                }}
            >
                {renderTextWithHighlights()}
            </div>
        </div>
    );
}