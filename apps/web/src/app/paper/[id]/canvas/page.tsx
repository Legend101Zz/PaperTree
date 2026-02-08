// apps/web/src/app/paper/[id]/canvas/page.tsx
'use client';

import { useCallback, useMemo, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ReactFlowProvider } from 'reactflow';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { PaperCanvas } from '@/components/canvas/PaperCanvas';
import { papersApi, canvasApi } from '@/lib/api';
import { ChevronLeft, BookOpen, Loader2, Sparkles } from 'lucide-react';
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

    // Auto-explore from URL params (highlight → canvas)
    useEffect(() => {
        if (!highlightId || !pageNumber || explored || isExploring || canvasLoading) return;

        const doExplore = async () => {
            setIsExploring(true);
            try {
                const result = await canvasApi.explore(paperId, {
                    highlight_id: highlightId,
                    question: question || 'Explain this',
                    ask_mode: askMode,
                    page_number: parseInt(pageNumber),
                });

                // Add new nodes to store
                const store = useCanvasStore.getState();
                if (result.page_node) store.addNode(result.page_node);
                store.addNode(result.exploration_node);
                store.addNode(result.ai_node);
                result.new_edges?.forEach(e => store.addEdge(e));

                // Refetch canvas to get updated state
                await refetchCanvas();
                setExplored(true);
            } catch (e) {
                console.error('Auto-explore failed:', e);
            } finally {
                setIsExploring(false);
            }
        };

        doExplore();
    }, [highlightId, pageNumber, explored, isExploring, canvasLoading, paperId, question, askMode, refetchCanvas]);

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
                        <span className="text-gray-300 dark:text-gray-700">|</span>
                        <h1 className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate max-w-md">
                            {paper?.title || 'Canvas'}
                        </h1>
                    </div>

                    <div className="flex items-center gap-2">
                        {isExploring && (
                            <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
                                <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                                Generating exploration...
                            </span>
                        )}
                    </div>
                </div>

                {/* Canvas */}
                <div className="flex-1">
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