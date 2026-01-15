'use client';

import { useCallback, useEffect } from 'react';
import ReactFlow, {
    Node,
    Edge,
    useNodesState,
    useEdgesState,
    addEdge,
    Connection,
    Background,
    Controls,
    MiniMap,
    NodeTypes,
    Handle,
    Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useCanvasStore } from '@/store/canvasStore';
import { truncateText } from '@/lib/utils';

// Custom node components
const PaperNode = ({ data }: { data: any }) => (
    <div className="bg-blue-100 dark:bg-blue-900 border-2 border-blue-500 rounded-lg p-4 min-w-[200px] max-w-[300px]">
        <Handle type="source" position={Position.Bottom} />
        <div className="font-bold text-blue-900 dark:text-blue-100">{data.label}</div>
        {data.content && (
            <div className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                {truncateText(data.content, 100)}
            </div>
        )}
    </div>
);

const HighlightNode = ({ data }: { data: any }) => (
    <div className="bg-yellow-100 dark:bg-yellow-900 border-2 border-yellow-500 rounded-lg p-3 min-w-[150px] max-w-[250px]">
        <Handle type="target" position={Position.Top} />
        <Handle type="source" position={Position.Bottom} />
        <div className="text-sm font-medium text-yellow-900 dark:text-yellow-100">
            Highlight
        </div>
        <div className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
            "{truncateText(data.content || '', 80)}"
        </div>
    </div>
);

const ExplanationNode = ({ data }: { data: any }) => (
    <div className="bg-green-100 dark:bg-green-900 border-2 border-green-500 rounded-lg p-3 min-w-[150px] max-w-[250px]">
        <Handle type="target" position={Position.Top} />
        <Handle type="source" position={Position.Bottom} />
        <div className="text-sm font-medium text-green-900 dark:text-green-100">
            {data.label}
        </div>
        <div className="text-sm text-green-700 dark:text-green-300 mt-1">
            {truncateText(data.content || '', 100)}
        </div>
    </div>
);

const nodeTypes: NodeTypes = {
    paper: PaperNode,
    highlight: HighlightNode,
    explanation: ExplanationNode,
};

interface PaperCanvasProps {
    initialNodes: Node[];
    initialEdges: Edge[];
    onSave: (nodes: Node[], edges: Edge[]) => void;
    onNodeClick: (nodeId: string, nodeType: string, data: any) => void;
}

export function PaperCanvas({
    initialNodes,
    initialEdges,
    onSave,
    onNodeClick,
}: PaperCanvasProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    // Update when initial data changes
    useEffect(() => {
        setNodes(initialNodes);
        setEdges(initialEdges);
    }, [initialNodes, initialEdges, setNodes, setEdges]);

    const onConnect = useCallback(
        (params: Connection) => setEdges((eds) => addEdge(params, eds)),
        [setEdges]
    );

    // Save on changes (debounced)
    useEffect(() => {
        const timeout = setTimeout(() => {
            onSave(nodes, edges);
        }, 1000);
        return () => clearTimeout(timeout);
    }, [nodes, edges, onSave]);

    const handleNodeClick = useCallback(
        (_: React.MouseEvent, node: Node) => {
            onNodeClick(node.id, node.type || '', node.data);
        },
        [onNodeClick]
    );

    return (
        <div className="w-full h-full">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={handleNodeClick}
                nodeTypes={nodeTypes}
                fitView
                className="bg-gray-50 dark:bg-gray-950"
            >
                <Background />
                <Controls />
                <MiniMap
                    nodeStrokeWidth={3}
                    zoomable
                    pannable
                />
            </ReactFlow>
        </div>
    );
}