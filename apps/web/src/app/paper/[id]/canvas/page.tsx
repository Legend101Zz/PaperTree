// apps/web/src/app/paper/[id]/canvas/page.tsx
'use client';

import { useCallback, useMemo, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ReactFlowProvider } from 'reactflow';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { PaperCanvas } from '@/components/canvas/PaperCanvas';
import { papersApi, canvasApi } from '@/lib/api';
import {
    ChevronLeft, BookOpen, Loader2, Sparkles, RefreshCw, LayoutGrid,
} from 'lucide-react';
import type { CanvasNode, CanvasEdge, Canvas, AskMode } from '@/types/canvas';
import { useCanvasStore } from '@/store/canvasStore';

export default function CanvasPage() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const queryClient = useQueryClient();
    const paperId = params.id as string;

    // URL params for auto-explore
    const highlightId = searchParams.get('highlight');
    const pageNumber = searchParams.get('page');
    const question = searchParams.get('question');
    const askMode = (searchParams.get('mode') || 'explain_simply') as AskMode;

    const [isExploring, setIsExploring] = useState(false);
    const [explored, setExplored] = useState(false);
    const [isPopulating, setIsPopulating] = useState(false);
    const [hasPopulated, setHasPopulated] = useState(false);

    // Fetch paper
    const { data: paper, isLoading: paperLoading } = useQuery({
        queryKey: ['paper', paperId],
        queryFn: () => papersApi.get(paperId),
    });

    // Fetch canvas
    const { data: canvas, isLoading: canvasLoading, refetch: refetchCanvas } = useQuery({
        queryKey: ['canvas', paperId],
        queryFn: () => canvasApi.get(paperId),
    });

    // ── Auto-populate canvas on first load ──
    useEffect(() => {
        if (canvasLoading || hasPopulated || isPopulating) return;

        // Only populate if canvas is nearly empty (just root node)
        const nodeCount = canvas?.elements?.nodes?.length || 0;
        if (nodeCount <= 1 && paper?.page_count && paper.page_count > 0) {
            setIsPopulating(true);
            canvasApi.populate(paperId)
                .then(async (result) => {
                    if (result.pages_created > 0 || result.explorations_created > 0) {
                        await refetchCanvas();
                    }
                    setHasPopulated(true);
                })
                .catch((e) => {
                    console.error('Auto-populate failed:', e);
                    setHasPopulated(true);
                })
                .finally(() => setIsPopulating(false));
        } else {
            setHasPopulated(true);
        }
    }, [canvasLoading, hasPopulated, isPopulating, canvas, paper, paperId, refetchCanvas]);

    // Auto-explore from URL params (highlight → canvas)
    useEffect(() => {
        if (!highlightId || !pageNumber || explored || isExploring || canvasLoading || !hasPopulated) return;

        const doExplore = async () => {
            setIsExploring(true);
            try {
                const result = await canvasApi.explore(paperId, {
                    highlight_id: highlightId,
                    question: question || 'Explain this',
                    ask_mode: askMode,
                    page_number: parseInt(pageNumber),
                });

                const store = useCanvasStore.getState();
                if (result.page_node) store.addNode(result.page_node);
                store.addNode(result.exploration_node);
                store.addNode(result.ai_node);
                result.new_edges?.forEach((e: any) => store.addEdge(e));

                await refetchCanvas();
                setExplored(true);
            } catch (e) {
                console.error('Auto-explore failed:', e);
            } finally {
                setIsExploring(false);
            }
        };

        doExplore();
    }, [highlightId, pageNumber, explored, isExploring, canvasLoading, hasPopulated, paperId, question, askMode, refetchCanvas]);

    // Save mutation
    const saveMutation = useMutation({
        mutationFn: (elements: { nodes: CanvasNode[]; edges: CanvasEdge[] }) =>
            canvasApi.save(paperId, elements),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['canvas', paperId] }),
    });

    const handleSave = useCallback((nodes: CanvasNode[], edges: CanvasEdge[]) => {
        saveMutation.mutate({ nodes, edges });
    }, [saveMutation]);

    const handleNodeClick = useCallback((nodeId: string, nodeType: string, data: any) => {
        if (data.highlight_id) {
            router.push(`/paper/${paperId}/read?highlight=${data.highlight_id}`);
        } else if (data.source?.page_number !== undefined) {
            router.push(`/paper/${paperId}/read?page=${data.source.page_number}`);
        } else if (data.source_page !== undefined) {
            router.push(`/paper/${paperId}/read?page=${data.source_page}`);
        }
    }, [router, paperId]);

    const handleRefreshCanvas = useCallback(async () => {
        setIsPopulating(true);
        try {
            await canvasApi.populate(paperId);
            await refetchCanvas();
        } catch (e) {
            console.error('Refresh failed:', e);
        } finally {
            setIsPopulating(false);
        }
    }, [paperId, refetchCanvas]);

    // Build initial nodes
    const initialNodes: CanvasNode[] = useMemo(() => {
        if (canvas?.elements?.nodes?.length) return canvas.elements.nodes;
        return [{
            id: `paper-${paperId}`,
            type: 'paper' as const,
            position: { x: 400, y: 50 },
            data: {
                label: paper?.title || 'Paper',
                content: paper?.book_content?.tldr || '',
                content_type: 'markdown' as const,
                is_collapsed: false,
                status: 'complete' as const,
                tags: [],
            },
        }];
    }, [canvas, paperId, paper]);

    const initialEdges: CanvasEdge[] = useMemo(
        () => canvas?.elements?.edges || [],
        [canvas],
    );

    const isLoading = paperLoading || canvasLoading;

    if (isLoading) {
        return (
            <AuthGuard>
                <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
                    <div className="flex flex-col items-center gap-3">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                        <p className="text-gray-500">Loading canvas...</p>
                    </div>
                </div>
            </AuthGuard>
        );
    }

    return (
        <AuthGuard>
            <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
                {/* Header bar */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => router.push(`/paper/${paperId}/read`)}
                            className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            <BookOpen className="w-4 h-4" />
                            Back to Reader
                        </button>
                        <div className="h-4 w-px bg-gray-300 dark:bg-gray-700" />
                        <h1 className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate max-w-[300px]">
                            {paper?.title || 'Canvas'}
                        </h1>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Refresh / sync with highlights */}
                        <button
                            onClick={handleRefreshCanvas}
                            disabled={isPopulating}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
                                bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400
                                hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors
                                disabled:opacity-50"
                            title="Sync canvas with latest highlights & explanations"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${isPopulating ? 'animate-spin' : ''}`} />
                            {isPopulating ? 'Syncing...' : 'Sync Highlights'}
                        </button>

                        {isExploring && (
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                                <span className="text-xs text-blue-600 dark:text-blue-400">Generating explanation...</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Canvas */}
                <div className="flex-1 relative">
                    {isPopulating && !canvas?.elements?.nodes?.length && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-50/80 dark:bg-gray-950/80 backdrop-blur-sm">
                            <div className="flex flex-col items-center gap-3 p-6 bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800">
                                <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Building your research canvas...</p>
                                <p className="text-xs text-gray-500">Creating page nodes and importing explanations</p>
                            </div>
                        </div>
                    )}

                    <ReactFlowProvider>
                        <PaperCanvas
                            paperId={paperId}
                            initialNodes={initialNodes}
                            initialEdges={initialEdges}
                            onSave={handleSave}
                            onNodeClick={handleNodeClick}
                        />
                    </ReactFlowProvider>
                </div>
            </div>
        </AuthGuard>
    );
}