import React, { useState, useRef, useEffect } from 'react';
import { PDFDocument, BlendMode } from 'pdf-lib';
import { FileText, Upload, Download, LayoutDashboard, FileUp, FileOutput, Loader2, Image as ImageIcon, Save, History, Trash2 } from 'lucide-react';
import { get, set, del } from 'idb-keyval';

interface Templates {
  header: string;
  footer: string;
  watermark: string;
}

interface HistoryMeta {
  id: string;
  filename: string;
  date: number;
}

const removeWhiteBackground = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas not supported'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (r > 240 && g > 240 && b > 240) {
          data[i + 3] = 0;
        }
      }
      
      ctx.putImageData(imageData, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        } else {
          reject(new Error('Canvas to Blob failed'));
        }
      }, 'image/png');
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
};

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};

export default function App() {
  const [templates, setTemplates] = useState<Templates | null>(null);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [currentView, setCurrentView] = useState<'dashboard' | 'history'>('dashboard');
  
  // Setup State
  const [setupHeader, setSetupHeader] = useState<File | null>(null);
  const [setupFooter, setSetupFooter] = useState<File | null>(null);
  const [setupWatermark, setSetupWatermark] = useState<File | null>(null);
  const [isSavingSetup, setIsSavingSetup] = useState(false);

  // Document Detail State (Filename generation)
  const [projectName, setProjectName] = useState(() => localStorage.getItem('renovki_projectName') || '');
  const [week, setWeek] = useState(() => localStorage.getItem('renovki_week') || '');
  const [target, setTarget] = useState(() => localStorage.getItem('renovki_target') || 'Klien');
  const [weight, setWeight] = useState(() => localStorage.getItem('renovki_weight') || '');

  // App State
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedPdfUrl, setProcessedPdfUrl] = useState<string | null>(null);
  const [generatedFilename, setGeneratedFilename] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // History State
  const [history, setHistory] = useState<HistoryMeta[]>([]);

  useEffect(() => {
    const loadTemplates = () => {
      const header = localStorage.getItem('renovki_header');
      const footer = localStorage.getItem('renovki_footer');
      const watermark = localStorage.getItem('renovki_watermark');
      
      if (header && footer && watermark) {
        setTemplates({ header, footer, watermark });
      }
      setIsLoadingTemplates(false);
    };
    loadTemplates();
    loadHistory();
  }, []);

  useEffect(() => {
    localStorage.setItem('renovki_projectName', projectName);
    localStorage.setItem('renovki_week', week);
    localStorage.setItem('renovki_target', target);
    localStorage.setItem('renovki_weight', weight);
  }, [projectName, week, target, weight]);

  const loadHistory = async () => {
    try {
      const meta = await get<HistoryMeta[]>('history_meta') || [];
      setHistory(meta.sort((a, b) => b.date - a.date));
    } catch (err) {
      console.error('Failed to load history', err);
    }
  };

  const addToHistory = async (filename: string, pdfBytes: Uint8Array) => {
    try {
      const id = Date.now().toString();
      const newMeta: HistoryMeta = { id, filename, date: Date.now() };
      
      const existingMeta = await get<HistoryMeta[]>('history_meta') || [];
      const updatedMeta = [...existingMeta, newMeta];
      
      await set('history_meta', updatedMeta);
      await set(`pdf_${id}`, pdfBytes);
      
      setHistory(updatedMeta.sort((a, b) => b.date - a.date));
    } catch (err) {
      console.error('Failed to save to history', err);
    }
  };

  const downloadFromHistory = async (id: string, filename: string) => {
    try {
      const pdfBytes = await get<Uint8Array>(`pdf_${id}`);
      if (pdfBytes) {
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        alert('File PDF tidak ditemukan di penyimpanan lokal.');
      }
    } catch (err) {
      console.error('Failed to download from history', err);
      alert('Gagal mengunduh file.');
    }
  };

  const deleteFromHistory = async (id: string) => {
    if (!window.confirm('Apakah Anda yakin ingin menghapus draft ini dari riwayat?')) return;
    try {
      const existingMeta = await get<HistoryMeta[]>('history_meta') || [];
      const updatedMeta = existingMeta.filter(m => m.id !== id);
      await set('history_meta', updatedMeta);
      await del(`pdf_${id}`);
      setHistory(updatedMeta.sort((a, b) => b.date - a.date));
    } catch (err) {
      console.error('Failed to delete from history', err);
    }
  };

  const handleSaveSetup = async () => {
    if (!setupHeader || !setupFooter || !setupWatermark) {
      setError('Mohon upload ketiga gambar template (Header, Footer, Watermark).');
      return;
    }

    setIsSavingSetup(true);
    setError(null);

    try {
      const headerB64 = await fileToBase64(setupHeader);
      const footerB64 = await fileToBase64(setupFooter);
      const watermarkB64 = await removeWhiteBackground(setupWatermark);

      localStorage.setItem('renovki_header', headerB64);
      localStorage.setItem('renovki_footer', footerB64);
      localStorage.setItem('renovki_watermark', watermarkB64);

      setTemplates({
        header: headerB64,
        footer: footerB64,
        watermark: watermarkB64
      });
    } catch (err) {
      console.error(err);
      setError('Gagal menyimpan template. Pastikan ukuran gambar tidak terlalu besar.');
    } finally {
      setIsSavingSetup(false);
    }
  };

  const resetTemplates = () => {
    if (window.confirm('Apakah Anda yakin ingin mereset template?')) {
      localStorage.removeItem('renovki_header');
      localStorage.removeItem('renovki_footer');
      localStorage.removeItem('renovki_watermark');
      setTemplates(null);
      setProcessedPdfUrl(null);
      setPdfFile(null);
    }
  };

  const getFilename = () => {
    const p = projectName.trim() || 'Project';
    const w = week.trim() ? `P.${week.trim()}` : 'P.X';
    const t = `(${target})`;
    const b = weight.trim() ? `Bobot ${weight.trim()}` : 'Bobot X';
    return `${p} ${w} ${t} ${b}.pdf`;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.type !== 'application/pdf') {
        setError('Please upload a valid PDF file.');
        return;
      }
      setPdfFile(file);
      await processPdf(file);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type !== 'application/pdf') {
        setError('Please upload a valid PDF file.');
        return;
      }
      setPdfFile(file);
      await processPdf(file);
    }
  };

  const processPdf = async (file: File) => {
    if (!templates) return;
    
    setIsProcessing(true);
    setError(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);

      const fetchImage = async (dataUrl: string) => {
        const res = await fetch(dataUrl);
        return await res.arrayBuffer();
      };

      const headerBytes = await fetchImage(templates.header);
      const footerBytes = await fetchImage(templates.footer);
      const watermarkBytes = await fetchImage(templates.watermark);

      const isHeaderPng = templates.header.startsWith('data:image/png');
      const isFooterPng = templates.footer.startsWith('data:image/png');
      const isWatermarkPng = templates.watermark.startsWith('data:image/png');

      const embeddedHeader = isHeaderPng ? await pdfDoc.embedPng(headerBytes) : await pdfDoc.embedJpg(headerBytes);
      const embeddedFooter = isFooterPng ? await pdfDoc.embedPng(footerBytes) : await pdfDoc.embedJpg(footerBytes);
      const embeddedWatermark = isWatermarkPng ? await pdfDoc.embedPng(watermarkBytes) : await pdfDoc.embedJpg(watermarkBytes);

      const pages = pdfDoc.getPages();

      for (const page of pages) {
        const { width, height } = page.getSize();

        // Header
        const headerDims = embeddedHeader.scale(1);
        const headerScale = width / headerDims.width;
        // Mengurangi tinggi header sebesar 30% (dikali 0.7) agar lebih pendek
        const scaledHeaderHeight = (headerDims.height * headerScale) * 0.7;
        page.drawImage(embeddedHeader, {
          x: 0,
          y: height - scaledHeaderHeight,
          width: width,
          height: scaledHeaderHeight,
        });

        // Footer
        const footerDims = embeddedFooter.scale(1);
        const footerScale = width / footerDims.width;
        // Mengurangi tinggi footer sebesar 30% (dikali 0.7) agar lebih pendek
        const scaledFooterHeight = (footerDims.height * footerScale) * 0.7;
        page.drawImage(embeddedFooter, {
          x: 0,
          y: 0,
          width: width,
          height: scaledFooterHeight,
        });

        // Watermark
        const wmDims = embeddedWatermark.scale(1);
        const maxWmWidth = width * 0.6;
        const maxWmHeight = height * 0.6;
        const wmScale = Math.min(maxWmWidth / wmDims.width, maxWmHeight / wmDims.height);
        const scaledWmWidth = wmDims.width * wmScale;
        const scaledWmHeight = wmDims.height * wmScale;
        
        page.drawImage(embeddedWatermark, {
          x: width / 2 - scaledWmWidth / 2,
          y: height / 2 - scaledWmHeight / 2,
          width: scaledWmWidth,
          height: scaledWmHeight,
          opacity: 0.15,
          blendMode: BlendMode.Multiply,
        });
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      
      const filename = getFilename();
      setGeneratedFilename(filename);
      setProcessedPdfUrl(url);
      
      // Save to history
      await addToHistory(filename, pdfBytes);

    } catch (err) {
      console.error(err);
      setError('An error occurred while processing the PDF.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (processedPdfUrl && pdfFile) {
      const a = document.createElement('a');
      a.href = processedPdfUrl;
      a.download = generatedFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(timestamp));
  };

  if (isLoadingTemplates) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div 
          className="h-16 flex items-center px-6 border-b border-gray-200 cursor-pointer select-none" 
          onDoubleClick={resetTemplates}
          title="Double-click to reset templates"
        >
          <div className="flex items-center gap-2 text-blue-600 font-bold text-xl tracking-tight">
            <FileText className="w-6 h-6" />
            <span>PDF Renovki</span>
          </div>
        </div>
        
        <nav className="flex-1 p-4 space-y-1">
          <button 
            onClick={() => setCurrentView('dashboard')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md font-medium transition-colors ${currentView === 'dashboard' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <LayoutDashboard className="w-5 h-5" />
            Dashboard
          </button>
          <button 
            onClick={() => setCurrentView('history')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md font-medium transition-colors ${currentView === 'history' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <History className="w-5 h-5" />
            Riwayat
          </button>
        </nav>
        
        <div className="p-4 border-t border-gray-200 text-xs text-gray-400 text-center">
          &copy; 2026 PDF Renovki<br/>
          <span className="opacity-50">Double-click logo to reset</span>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center px-8">
          <h1 className="text-xl font-semibold text-gray-800">
            {currentView === 'dashboard' ? 'Dashboard' : 'Riwayat Dokumen'}
          </h1>
        </header>

        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-5xl mx-auto">
            
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                {error}
              </div>
            )}

            {!templates ? (
              /* Setup Screen */
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
                <div className="text-center mb-8">
                  <h2 className="text-2xl font-bold text-gray-900">Setup Template Satu Kali</h2>
                  <p className="text-gray-500 mt-2">Silakan unggah ketiga gambar template Anda di sini. Ini hanya perlu dilakukan sekali.</p>
                </div>

                <div className="space-y-6">
                  {/* Header Upload */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">1. Upload Gambar Header</label>
                    <div className="flex items-center gap-4">
                      <label className="flex-1 flex items-center justify-center px-4 py-4 border-2 border-dashed border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                        <input type="file" accept="image/png, image/jpeg" className="hidden" onChange={(e) => e.target.files && setSetupHeader(e.target.files[0])} />
                        <div className="flex items-center gap-2 text-gray-600">
                          <ImageIcon className="w-5 h-5" />
                          <span>{setupHeader ? setupHeader.name : 'Pilih Gambar Header'}</span>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Footer Upload */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">2. Upload Gambar Footer</label>
                    <div className="flex items-center gap-4">
                      <label className="flex-1 flex items-center justify-center px-4 py-4 border-2 border-dashed border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                        <input type="file" accept="image/png, image/jpeg" className="hidden" onChange={(e) => e.target.files && setSetupFooter(e.target.files[0])} />
                        <div className="flex items-center gap-2 text-gray-600">
                          <ImageIcon className="w-5 h-5" />
                          <span>{setupFooter ? setupFooter.name : 'Pilih Gambar Footer'}</span>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Watermark Upload */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">3. Upload Gambar Watermark</label>
                    <div className="flex items-center gap-4">
                      <label className="flex-1 flex items-center justify-center px-4 py-4 border-2 border-dashed border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                        <input type="file" accept="image/png, image/jpeg" className="hidden" onChange={(e) => e.target.files && setSetupWatermark(e.target.files[0])} />
                        <div className="flex items-center gap-2 text-gray-600">
                          <ImageIcon className="w-5 h-5" />
                          <span>{setupWatermark ? setupWatermark.name : 'Pilih Gambar Watermark'}</span>
                        </div>
                      </label>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">Background putih akan otomatis dihapus.</p>
                  </div>

                  <button
                    onClick={handleSaveSetup}
                    disabled={isSavingSetup || !setupHeader || !setupFooter || !setupWatermark}
                    className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-8"
                  >
                    {isSavingSetup ? (
                      <><Loader2 className="w-5 h-5 animate-spin" /> Menyimpan Template...</>
                    ) : (
                      <><Save className="w-5 h-5" /> Simpan Template & Mulai</>
                    )}
                  </button>
                </div>
              </div>
            ) : currentView === 'dashboard' ? (
              /* Dashboard View */
              <div className="space-y-6">
                
                {/* Detail Dokumen Form */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Detail Dokumen (Untuk Penamaan File)</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Nama Project</label>
                      <input 
                        type="text" 
                        value={projectName} 
                        onChange={e => setProjectName(e.target.value)} 
                        placeholder="Contoh: Renovasi Rumah Bpk. Budi" 
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" 
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Pekan Ke-</label>
                      <div className="flex items-center">
                        <span className="px-3 py-2 bg-gray-100 border border-r-0 border-gray-300 rounded-l-md text-gray-500">P.</span>
                        <input 
                          type="text" 
                          value={week} 
                          onChange={e => setWeek(e.target.value)} 
                          placeholder="1" 
                          className="w-full px-3 py-2 border border-gray-300 rounded-r-md focus:outline-none focus:ring-2 focus:ring-blue-500" 
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Klien / Kantor</label>
                      <select 
                        value={target} 
                        onChange={e => setTarget(e.target.value)} 
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      >
                        <option value="Klien">Klien</option>
                        <option value="Kantor">Kantor</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Bobot</label>
                      <input 
                        type="text" 
                        value={weight} 
                        onChange={e => setWeight(e.target.value)} 
                        placeholder="Contoh: 20%" 
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" 
                      />
                    </div>
                  </div>
                  <div className="mt-4 p-3 bg-blue-50 rounded-md border border-blue-100">
                    <p className="text-sm text-blue-800">
                      <strong>Preview Nama File:</strong> {getFilename()}
                    </p>
                  </div>
                </div>

                {/* Upload Area */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    className="border-2 border-dashed border-blue-200 rounded-xl p-12 text-center bg-blue-50/50 hover:bg-blue-50 transition-colors cursor-pointer"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept="application/pdf"
                      className="hidden"
                    />
                    <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <FileUp className="w-8 h-8" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">Upload PDF Document</h3>
                    <p className="text-gray-500 mb-4">Drag and drop your PDF here, or click to browse</p>
                    <span className="inline-flex items-center justify-center px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
                      Select File
                    </span>
                  </div>
                </div>

                {/* Processing & Result Area */}
                {(isProcessing || processedPdfUrl) && (
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
                    {isProcessing ? (
                      <div className="flex flex-col items-center justify-center py-12">
                        <Loader2 className="w-12 h-12 animate-spin text-blue-600 mb-4" />
                        <h3 className="text-lg font-medium text-gray-900">Memproses PDF...</h3>
                        <p className="text-gray-500">Menerapkan Header, Footer, dan Watermark</p>
                      </div>
                    ) : processedPdfUrl ? (
                      <div className="flex flex-col items-center justify-center py-8">
                        <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-4">
                          <FileOutput className="w-8 h-8" />
                        </div>
                        <h3 className="text-xl font-semibold text-gray-900 mb-2">PDF Berhasil Diproses!</h3>
                        <p className="text-gray-500 mb-8 text-center max-w-md">
                          Dokumen Anda telah berhasil diperbarui dan disimpan ke Riwayat.
                        </p>
                        
                        <div className="flex gap-4">
                          <a
                            href={processedPdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-6 py-3 bg-white border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                          >
                            <FileText className="w-5 h-5" />
                            Preview PDF
                          </a>
                          <button
                            onClick={handleDownload}
                            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-sm"
                          >
                            <Download className="w-5 h-5" />
                            Download PDF
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ) : (
              /* History View */
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-6 border-b border-gray-200">
                  <h2 className="text-lg font-semibold text-gray-900">Riwayat Dokumen (Draft)</h2>
                  <p className="text-sm text-gray-500 mt-1">Dokumen yang telah diproses akan tersimpan di sini secara lokal di browser Anda.</p>
                </div>
                
                {history.length === 0 ? (
                  <div className="p-12 text-center text-gray-500">
                    <History className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                    <p>Belum ada riwayat dokumen.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Nama File</th>
                          <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Tanggal Dibuat</th>
                          <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider text-right">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {history.map((item) => (
                          <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-3">
                                <FileText className="w-5 h-5 text-blue-500" />
                                <span className="font-medium text-gray-900">{item.filename}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {formatDate(item.date)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                              <div className="flex items-center justify-end gap-3">
                                <button 
                                  onClick={() => downloadFromHistory(item.id, item.filename)}
                                  className="text-blue-600 hover:text-blue-900 flex items-center gap-1"
                                >
                                  <Download className="w-4 h-4" /> Download
                                </button>
                                <button 
                                  onClick={() => deleteFromHistory(item.id)}
                                  className="text-red-600 hover:text-red-900 flex items-center gap-1 ml-4"
                                >
                                  <Trash2 className="w-4 h-4" /> Hapus
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </main>
    </div>
  );
}
