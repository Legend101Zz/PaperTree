// apps/web/src/components/canvas/nodes/NoteNode.tsx
'use client';

import { memo, useState, useRef, useEffect } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { StickyNote, Trash2, Check, Edit3 } from 'lucide-react';

function NoteNodeComponent({ data, selected }: NodeProps) {
    const [hovered, setHovered] = useState(false);
    const [editing, setEditing] = useState(false);
    const [editContent, setEditContent] = useState(data.content || '');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (editing && textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(editContent.length, editContent.length);
        }
    }, [editing]);

    const handleSave = () => {
        data.onUpdateContent?.(editContent);
        setEditing(false);
    };

    return (
        <div
            className={`
        rounded-xl shadow-md border-2 transition-all duration-200
        bg-yellow-50 dark:bg-yellow-950/20 border-yellow-300 dark:border-yellow-700
        ${selected ? 'ring-2 ring-yellow-500 ring-offset-2' : ''}
        ${hovered ? 'shadow-lg scale-[1.01]' : ''}
      `}
            style={{ minWidth: 200, maxWidth: 300 }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <Handle type="target" position={Position.Top} className="!bg-yellow-400 !w-3 !h-3" />
            <Handle type="source" position={Position.Bottom} className="!bg-yellow-400 !w-3 !h-3" />

            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-yellow-200 dark:border-yellow-800">
                <StickyNote className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                <span className="flex-1 text-xs font-medium text-yellow-800 dark:text-yellow-200 uppercase tracking-wide">
                    Note
                </span>
                {hovered && (
                    <div className="flex items-center gap-1">
                        {editing ? (
                            <button
                                onClick={(e) => { e.stopPropagation(); handleSave(); }}
                                className="p-1 hover:bg-yellow-200 dark:hover:bg-yellow-800 rounded"
                            >
                                <Check className="w-3.5 h-3.5 text-green-600" />
                            </button>
                        ) : (
                            <button
                                onClick={(e) => { e.stopPropagation(); setEditing(true); }}
                                className="p-1 hover:bg-yellow-200 dark:hover:bg-yellow-800 rounded"
                            >
                                <Edit3 className="w-3.5 h-3.5 text-yellow-600" />
                            </button>
                        )}
                        {data.onDelete && (
                            <button
                                onClick={(e) => { e.stopPropagation(); data.onDelete(); }}
                                className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded"
                            >
                                <Trash2 className="w-3.5 h-3.5 text-red-500" />
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="px-3 py-3">
                {editing ? (
                    <textarea
                        ref={textareaRef}
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave();
                            if (e.key === 'Escape') { setEditing(false); setEditContent(data.content || ''); }
                        }}
                        className="w-full min-h-[60px] text-sm bg-transparent border-none outline-none resize-none text-yellow-900 dark:text-yellow-100 placeholder-yellow-400"
                        placeholder="Type your note..."
                    />
                ) : (
                    <p className="text-sm text-yellow-900 dark:text-yellow-100 whitespace-pre-wrap">
                        {data.content || 'Empty note'}
                    </p>
                )}
            </div>
        </div>
    );
}

export const NoteNode = memo(NoteNodeComponent);