'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { ReaderToolbar } from '@/components/reader/ReaderToolbar';
import { PDFViewer } from '@/components/reader/PDFViewer';
import { BookViewer } from '@/components/reader/BookViewer';
import { OutlinePanel } from '@/components/reader/OutlinePanel';
import { ExplanationPanel } from '@/components/reader/ExplanationPanel';
import { HighlightPopup } from '@/components/reader/HighlightPopup';
import { useReaderStore } from '@/store/readerStore';
import { papersApi, highlightsApi, explanationsApi, canvasApi } from '@/lib/api';
import { Highlight, Explanation, OutlineItem } from '@/types';

export default function ReaderPage() {
    const params = useParams();
    const paperId = params.id as string;
    const queryClient = useQueryClient();

    // Track if we've synced data to avoid loops
    const highlightsSynced = useRef(false);
    const explanationsSynced = useRef(false);

    // Get store state and actions separately to avoid re-render issues
    const settings = useReaderStore((state) => state.settings);
    const highlights = useReaderStore((state) => state.highlights);
    const explanations = useReaderStore((state) => state.explanations);
    const activeHighlightId = useReaderStore((state) => state.activeHighlightId);
    const selectedText = useReaderStore((state) => state.selectedText);
    const selectionPosition = useReaderStore((state) => state.selectionPosition);

    // Get actions (these are stable references)
    const setHighlights = useReaderStore((state) => state.setHighlights);
    const setExplanations = useReaderStore((state) => state.setExplanations);
    const addHighlight = useReaderStore((state) => state.addHighlight);
    const addExplanation = useReaderStore((state) => state.addExplanation);
    const setActiveHighlight = useReaderStore((state) => state.setActiveHighlight);
    const setSelection = useReaderStore((state) => state.setSelection);
    const clearSelection = useReaderStore((state) => state.clearSelection);
    const updateExplanation = useReaderStore((state) => state.updateExplanation);
    const resetReaderState = useReaderStore((state) => state.resetReaderState);

    const [pendingHighlight, setPendingHighlight] = useState<any>(null);
    const [scrollToSection, setScrollToSection] = useState<OutlineItem | null>(null);
    // Reset state when paper changes
    useEffect(() => {
        highlightsSynced.current = false;
        explanationsSynced.current = false;
        resetReaderState();
    }, [paperId, resetReaderState]);

    // Fetch paper data
    const { data: paper, isLoading: paperLoading } = useQuery({
        queryKey: ['paper', paperId],
        queryFn: () => papersApi.get(paperId),
        enabled: !!paperId,
    });

    // Fetch highlights
    const { data: fetchedHighlights } = useQuery({
        queryKey: ['highlights', paperId],
        queryFn: () => highlightsApi.list(paperId),
        enabled: !!paperId,
    });

    // Fetch explanations
    const { data: fetchedExplanations } = useQuery({
        queryKey: ['explanations', paperId],
        queryFn: () => explanationsApi.list(paperId),
        enabled: !!paperId,
    });

    // Sync highlights to store (only once per fetch)
    useEffect(() => {
        if (fetchedHighlights && !highlightsSynced.current) {
            setHighlights(fetchedHighlights);
            highlightsSynced.current = true;
        }
    }, [fetchedHighlights, setHighlights]);

    // Sync explanations to store (only once per fetch)
    useEffect(() => {
        if (fetchedExplanations && !explanationsSynced.current) {
            setExplanations(fetchedExplanations);
            explanationsSynced.current = true;
        }
    }, [fetchedExplanations, setExplanations]);

    // Create highlight mutation
    const createHighlightMutation = useMutation({
        mutationFn: (data: Parameters<typeof highlightsApi.create>[1]) =>
            highlightsApi.create(paperId, data),
        onSuccess: (newHighlight) => {
            addHighlight(newHighlight);
            highlightsSynced.current = true; // Prevent re-sync
        },
    });

    // Create explanation mutation
    const createExplanationMutation = useMutation({
        mutationFn: (data: Parameters<typeof explanationsApi.create>[1]) =>
            explanationsApi.create(paperId, data),
        onSuccess: (newExplanation) => {
            addExplanation(newExplanation);
            explanationsSynced.current = true; // Prevent re-sync
            queryClient.invalidateQueries({ queryKey: ['explanations', paperId] });
        },
    });

    // Update explanation mutation
    const updateExplanationMutation = useMutation({
        mutationFn: ({ id, data }: { id: string; data: Parameters<typeof explanationsApi.update>[1] }) =>
            explanationsApi.update(id, data),
        onSuccess: (updated) => {
            updateExplanation(updated.id, updated);
        },
    });

    // Handle text selection in PDF mode
    const handlePDFTextSelect = useCallback((text: string, pageNumber: number, rects: any[]) => {
        if (!text.trim()) return;

        const rect = rects[0];
        setSelection(text, { x: rect.x + rect.w, y: rect.y });

        // Store pending highlight data
        setPendingHighlight({
            mode: 'pdf' as const,
            selected_text: text,
            page_number: pageNumber,
            rects: rects.map(r => ({
                x: r.x / window.innerWidth,
                y: r.y / window.innerHeight,
                w: r.w / window.innerWidth,
                h: r.h / window.innerHeight,
            })),
        });
    }, [setSelection]);

    // Handle text selection in Book mode
    const handleBookTextSelect = useCallback((text: string, anchor: any) => {
        if (!text.trim()) return;

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        setSelection(text, { x: rect.right, y: rect.top });

        setPendingHighlight({
            mode: 'book' as const,
            selected_text: text,
            anchor,
        });
    }, [setSelection]);

    // Handle Ask AI
    const handleAskAI = useCallback(async (question: string) => {
        if (!pendingHighlight) return;

        try {
            // First create the highlight
            const highlight = await createHighlightMutation.mutateAsync(pendingHighlight);

            // Then create the explanation
            await createExplanationMutation.mutateAsync({
                highlight_id: highlight.id,
                question,
            });

            clearSelection();
            setPendingHighlight(null);
        } catch (error) {
            console.error('Failed to create explanation:', error);
        }
    }, [pendingHighlight, createHighlightMutation, createExplanationMutation, clearSelection]);

    // Handle follow-up question
    const handleFollowUp = useCallback(async (parentId: string, question: string) => {
        const parent = explanations.find(e => e.id === parentId);
        if (!parent) return;

        await createExplanationMutation.mutateAsync({
            highlight_id: parent.highlight_id,
            question,
            parent_id: parentId,
        });
    }, [explanations, createExplanationMutation]);

    // Handle send to canvas
    const handleSendToCanvas = useCallback(async (highlightId: string, exps: Explanation[]) => {
        const highlight = highlights.find(h => h.id === highlightId);
        if (!highlight) return;

        try {
            // Get current canvas
            const canvas = await canvasApi.get(paperId);
            const currentElements = canvas.elements || { nodes: [], edges: [] };

            // Create nodes for highlight and explanations
            const newNodes: any[] = [];
            const newEdges: any[] = [];

            // Find a good position for new nodes
            const baseX = 100 + currentElements.nodes.length * 50;
            const baseY = 100;

            // Paper node (if not exists)
            const paperNodeId = `paper-${paperId}`;
            if (!currentElements.nodes.find((n: any) => n.id === paperNodeId)) {
                newNodes.push({
                    id: paperNodeId,
                    type: 'paper',
                    position: { x: 400, y: 50 },
                    data: { label: paper?.title || 'Paper' },
                });
            }

            // Highlight node
            const highlightNodeId = `highlight-${highlightId}`;
            if (!currentElements.nodes.find((n: any) => n.id === highlightNodeId)) {
                newNodes.push({
                    id: highlightNodeId,
                    type: 'highlight',
                    position: { x: baseX, y: baseY + 150 },
                    data: {
                        label: 'Highlight',
                        content: highlight.selected_text,
                        highlightId,
                    },
                });
                newEdges.push({
                    id: `edge-${paperNodeId}-${highlightNodeId}`,
                    source: paperNodeId,
                    target: highlightNodeId,
                });
            }

            // Explanation nodes
            exps.forEach((exp, idx) => {
                const expNodeId = `explanation-${exp.id}`;
                if (!currentElements.nodes.find((n: any) => n.id === expNodeId)) {
                    newNodes.push({
                        id: expNodeId,
                        type: 'explanation',
                        position: { x: baseX + idx * 50, y: baseY + 300 + idx * 100 },
                        data: {
                            label: exp.question,
                            content: exp.answer_markdown.slice(0, 200),
                            explanationId: exp.id,
                        },
                    });
                    newEdges.push({
                        id: `edge-${highlightNodeId}-${expNodeId}`,
                        source: exp.parent_id ? `explanation-${exp.parent_id}` : highlightNodeId,
                        target: expNodeId,
                    });
                }
            });

            // Update canvas
            await canvasApi.update(paperId, {
                nodes: [...currentElements.nodes, ...newNodes],
                edges: [...currentElements.edges, ...newEdges],
            });

            alert('Sent to canvas!');
        } catch (error) {
            console.error('Failed to send to canvas:', error);
        }
    }, [highlights, paperId, paper]);

    // Handle search
    const handleSearch = useCallback(async (query: string) => {
        if (!query.trim()) return;
        try {
            const results = await papersApi.search(paperId, query);
            if (results.length > 0) {
                alert(`Found ${results.length} matches for "${query}"`);
            } else {
                alert(`No matches found for "${query}"`);
            }
        } catch (error) {
            console.error('Search failed:', error);
        }
    }, [paperId]);

    // Handle summarize
    const handleSummarize = useCallback(async (explanationId: string) => {
        try {
            const result = await explanationsApi.summarize(explanationId);
            alert(`Summary:\n\n${result.summary}`);
        } catch (error) {
            console.error('Summarize failed:', error);
        }
    }, []);

    // Apply theme
    useEffect(() => {
        const root = document.documentElement;
        root.classList.remove('dark', 'sepia');
        if (settings.theme === 'dark') {
            root.classList.add('dark');
        } else if (settings.theme === 'sepia') {
            root.classList.add('sepia');
        }
    }, [settings.theme]);

    if (paperLoading || !paper) {
        return (
            <AuthGuard>
                <div className="min-h-screen flex items-center justify-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
                </div>
            </AuthGuard>
        );
    }

    // Use the getFileUrl function which includes the token
    const pdfUrl = papersApi.getFileUrl(paperId);

    return (
        <AuthGuard>
            <div className="min-h-screen flex flex-col">
                <ReaderToolbar
                    paperId={paperId}
                    paperTitle={paper.title}
                    onSearch={handleSearch}
                />

                <div className="flex-1 flex overflow-hidden">
                    {/* Left panel - Outline */}
                    <div className="w-64 border-r border-gray-200 dark:border-gray-700 overflow-y-auto hidden lg:block bg-white dark:bg-gray-900">
                        <OutlinePanel
                            outline={paper.outline || []}
                            onSectionClick={(section) => {
                                console.log('Navigate to section:', section);
                                setScrollToSection(section);
                                // Clear after a short delay to allow re-clicking same section
                                setTimeout(() => setScrollToSection(null), 100);
                            }}
                        />
                    </div>

                    {/* Middle panel - Reader */}
                    <div className="flex-1 overflow-hidden">
                        {settings.mode === 'pdf' ? (
                            <PDFViewer
                                fileUrl={pdfUrl}
                                highlights={highlights}
                                onTextSelect={handlePDFTextSelect}
                            />
                        ) : (
                            <BookViewer
                                text={paper.extracted_text || ''}
                                outline={paper.outline || []}
                                highlights={highlights}
                                onTextSelect={handleBookTextSelect}
                                scrollToSection={scrollToSection}
                            />
                        )}


                    </div>

                    {/* Right panel - Explanations */}
                    <div className="w-96 border-l border-gray-200 dark:border-gray-700 overflow-y-auto hidden md:block bg-white dark:bg-gray-900">
                        <ExplanationPanel
                            highlights={highlights}
                            explanations={explanations}
                            onFollowUp={handleFollowUp}
                            onTogglePin={(id, isPinned) =>
                                updateExplanationMutation.mutate({ id, data: { is_pinned: isPinned } })
                            }
                            onToggleResolved={(id, isResolved) =>
                                updateExplanationMutation.mutate({ id, data: { is_resolved: isResolved } })
                            }
                            onSummarize={handleSummarize}
                            onHighlightClick={setActiveHighlight}
                            onSendToCanvas={handleSendToCanvas}
                            isLoading={createExplanationMutation.isPending}
                            activeHighlightId={activeHighlightId}
                        />
                    </div>
                </div>

                {/* Highlight popup */}
                {selectedText && selectionPosition && (
                    <HighlightPopup
                        position={selectionPosition}
                        onAskAI={handleAskAI}
                        onClose={() => {
                            clearSelection();
                            setPendingHighlight(null);
                        }}
                        isLoading={createHighlightMutation.isPending || createExplanationMutation.isPending}
                    />
                )}
            </div>
        </AuthGuard>
    );
} 