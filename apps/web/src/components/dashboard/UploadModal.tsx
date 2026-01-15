'use client';

import { useState, useRef } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Upload, FileText } from 'lucide-react';

interface UploadModalProps {
    isOpen: boolean;
    onClose: () => void;
    onUpload: (file: File) => Promise<void>;
    isUploading: boolean;
}

export function UploadModal({ isOpen, onClose, onUpload, isUploading }: UploadModalProps) {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = (file: File) => {
        if (file.type === 'application/pdf') {
            setSelectedFile(file);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFileSelect(file);
    };

    const handleUpload = async () => {
        if (!selectedFile) return;
        await onUpload(selectedFile);
        setSelectedFile(null);
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Upload Paper">
            <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
                    }`}
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
            >
                {selectedFile ? (
                    <div className="flex items-center justify-center gap-3">
                        <FileText className="w-8 h-8 text-blue-500" />
                        <span className="font-medium">{selectedFile.name}</span>
                    </div>
                ) : (
                    <>
                        <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                        <p className="text-gray-600 dark:text-gray-400">
                            Drag and drop a PDF file here, or
                        </p>
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="text-blue-600 hover:text-blue-700 font-medium mt-1"
                        >
                            browse to upload
                        </button>
                    </>
                )}
            </div>
            <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(file);
                }}
            />
            <div className="flex gap-3 mt-6">
                <Button variant="secondary" onClick={onClose} className="flex-1">
                    Cancel
                </Button>
                <Button
                    variant="primary"
                    onClick={handleUpload}
                    disabled={!selectedFile || isUploading}
                    isLoading={isUploading}
                    className="flex-1"
                >
                    Upload
                </Button>
            </div>
        </Modal>
    );
}