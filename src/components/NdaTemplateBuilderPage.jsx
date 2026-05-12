import { useMemo, useState, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { api } from "../api/client";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const VIEWER_WIDTH = 850;

const FIELD_OPTIONS = [
  { field_key: "employee_name", field_label: "Employee Name", field_type: "text", signer_role: "employee" },
  { field_key: "employee_address", field_label: "Employee Address", field_type: "text", signer_role: "employee" },
  { field_key: "employee_initials", field_label: "Employee Initials", field_type: "initials", signer_role: "employee" },
  { field_key: "employee_signature", field_label: "Employee Signature", field_type: "signature", signer_role: "employee" },
  { field_key: "employee_title", field_label: "Employee Title", field_type: "text", signer_role: "employee" },
  { field_key: "employee_date", field_label: "Employee Date", field_type: "date", signer_role: "employee" },
  { field_key: "shree_initials", field_label: "Shree Initials", field_type: "initials", signer_role: "shree" },
  { field_key: "shree_signature", field_label: "Shree Signature", field_type: "signature", signer_role: "shree" },
  { field_key: "shree_date", field_label: "Shree Date", field_type: "date", signer_role: "shree" },
  { field_key: "custom", field_label: "Custom Field...", field_type: "text", signer_role: "employee" },
];

export default function NdaTemplateBuilderPage({ currentUser, isDark, onBack, editDoc }) {
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [templateName, setTemplateName] = useState("New Document Template");
  const [templateCategory, setTemplateCategory] = useState("nda");
  const [templateDescription, setTemplateDescription] = useState("");
  const [showToNewUsers, setShowToNewUsers] = useState(false);
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [fields, setFields] = useState([]);
  const [pageMetrics, setPageMetrics] = useState({});
  const [selectedFieldKey, setSelectedFieldKey] = useState(FIELD_OPTIONS[0].field_key);
  
  const [customFieldLabel, setCustomFieldLabel] = useState("");
  const [customFieldType, setCustomFieldType] = useState("text");
  const [customFieldRole, setCustomFieldRole] = useState("employee");

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isAddingBox, setIsAddingBox] = useState(false);
  const [resizingField, setResizingField] = useState(null);

  useEffect(() => {
    if (editDoc) {
      setTemplateName(editDoc.title || "");
      setTemplateCategory(editDoc.category || "nda");
      setTemplateDescription(editDoc.description || "");
      setShowToNewUsers(!!editDoc.show_to_new_users);
      if (editDoc.file_data || editDoc.file_url) {
        setPdfUrl(editDoc.file_data || editDoc.file_url);
      }
      
      api.nda.getTemplateFields(editDoc.id)
        .then((res) => { if (res.fields) setFields(res.fields); })
        .catch(console.error);
    }
  }, [editDoc]);

  const selectedField = useMemo(
    () => FIELD_OPTIONS.find((f) => f.field_key === selectedFieldKey),
    [selectedFieldKey]
  );

  const isHRManager =
    currentUser?.type === "admin" ||
    (currentUser?.type === "manager" &&
      ["hr", "finance"].includes((currentUser?.department_name || "").toLowerCase()));

  const inputClass = isDark
    ? "bg-slate-700 border-slate-600 text-white rounded-lg px-3 py-2 w-full text-sm border"
    : "bg-white border-gray-300 text-gray-900 rounded-lg px-3 py-2 w-full text-sm border";

  const getCurrentPageMetrics = () =>
    pageMetrics[pageNumber] || {
      viewer_width: VIEWER_WIDTH,
      viewer_height: null,
      pdf_width: null,
      pdf_height: null,
    };

  const loadAllPageMetrics = async (pdf) => {
    const metrics = {};

    for (let i = 1; i <= pdf.numPages; i += 1) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });

      const pdfWidth = viewport.width;
      const pdfHeight = viewport.height;
      const viewerHeight = Math.round((VIEWER_WIDTH / pdfWidth) * pdfHeight);

      metrics[i] = {
        viewer_width: VIEWER_WIDTH,
        viewer_height: viewerHeight,
        pdf_width: pdfWidth,
        pdf_height: pdfHeight,
      };
    }

    setPageMetrics(metrics);
    return metrics;
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      setMessage("Only PDF files are allowed.");
      return;
    }

    if (pdfUrl) URL.revokeObjectURL(pdfUrl);

    setPdfFile(file);
    setPdfUrl(URL.createObjectURL(file));
    setFields([]);
    setPageMetrics({});
    setPageNumber(1);
    setNumPages(null);
    setMessage("");
  };

  const handleAddBoxClick = () => {
    if (!selectedField) return;
    setIsAddingBox(true);
    setMessage("Click anywhere on the PDF document to place the box.");
  };

  const handlePdfClick = (e, pageNum) => {
    if (!isAddingBox) return;
    if (!selectedField) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const metrics = pageMetrics[pageNum];

    const isCustom = selectedField.field_key === "custom";
    const actualLabel = isCustom ? (customFieldLabel || "Custom Field") : selectedField.field_label;
    const actualType = isCustom ? customFieldType : selectedField.field_type;
    const actualRole = isCustom ? customFieldRole : selectedField.signer_role;
    const actualKey = isCustom ? `custom_${Date.now()}` : selectedField.field_key;

    const width = actualType === "signature" ? 220 : 150;
    const height = actualType === "signature" ? 55 : 30;

    const x = e.clientX - rect.left - width / 2;
    const y = e.clientY - rect.top - height / 2;

    const maxX = Math.max(0, rect.width - width);
    const maxY = Math.max(0, rect.height - height);

    const newField = {
      id: `${actualKey}_${Date.now()}`,
      field_key: actualKey,
      field_label: actualLabel,
      field_type: actualType,
      signer_role: actualRole,
      page_number: pageNum,
      x: Math.min(maxX, Math.max(0, Math.round(x))),
      y: Math.min(maxY, Math.max(0, Math.round(y))),
      width,
      height,
      viewer_width: metrics.viewer_width,
      viewer_height: metrics.viewer_height,
      pdf_width: metrics.pdf_width,
      pdf_height: metrics.pdf_height,
      required: true,
    };

    setFields((prev) => [...prev, newField]);
    setIsAddingBox(false);
    setMessage("Box placed successfully.");
  };

  const updateField = (id, patch) => {
    setFields((prev) =>
      prev.map((field) => (field.id === id ? { ...field, ...patch } : field))
    );
  };

  const removeField = (id) => {
    setFields((prev) => prev.filter((field) => field.id !== id));
  };

  const handleResizeStart = (e, field) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingField({
      id: field.id,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: field.width,
      startHeight: field.height,
    });
  };

  useEffect(() => {
    if (!resizingField) return;

    const handleMouseMove = (e) => {
      const dx = e.clientX - resizingField.startX;
      const dy = e.clientY - resizingField.startY;
      
      updateField(resizingField.id, {
        width: Math.max(30, resizingField.startWidth + dx),
        height: Math.max(20, resizingField.startHeight + dy),
      });
    };

    const handleMouseUp = () => {
      setResizingField(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizingField]);

  const handleDragStart = (e, field) => {
    e.dataTransfer.setData("field_id", field.id);
  };

  const handleDrop = (e, pageNum) => {
    e.preventDefault();

    const fieldId = e.dataTransfer.getData("field_id");
    if (!fieldId) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const metrics = pageMetrics[pageNum];

    const existingField = fields.find((field) => field.id === fieldId);
    const fieldWidth = Number(existingField?.width || 0);
    const fieldHeight = Number(existingField?.height || 0);

    const x = e.clientX - rect.left - fieldWidth / 2;
    const y = e.clientY - rect.top - fieldHeight / 2;

    const maxX = Math.max(0, rect.width - fieldWidth);
    const maxY = Math.max(0, rect.height - fieldHeight);

    updateField(fieldId, {
      x: Math.min(maxX, Math.max(0, Math.round(x))),
      y: Math.min(maxY, Math.max(0, Math.round(y))),
      page_number: pageNum,
      viewer_width: metrics?.viewer_width || VIEWER_WIDTH,
      viewer_height: metrics.viewer_height || rect.height,
      pdf_width: metrics.pdf_width,
      pdf_height: metrics.pdf_height,
    });
  };

  const handleSave = async () => {
    if (!pdfFile && !editDoc) {
      setMessage("Please upload an NDA PDF first.");
      return;
    }

    if (fields.length === 0) {
      setMessage("Please add at least one field box.");
      return;
    }

    try {
      setSaving(true);
      setMessage("");

      const cleanFields = fields.map(({ id, ...rest }) => {
        const metrics = pageMetrics[rest.page_number];

        if (!metrics) {
          throw new Error(
            `Missing PDF size data for page ${rest.page_number}. Please wait for PDF to fully load.`
          );
        }

        return {
          ...rest,
          page_number: Number(rest.page_number),
          x: Number(rest.x),
          y: Number(rest.y),
          width: Number(rest.width),
          height: Number(rest.height),
          viewer_width: Number(metrics.viewer_width),
          viewer_height: Number(metrics.viewer_height),
          pdf_width: Number(metrics.pdf_width),
          pdf_height: Number(metrics.pdf_height),
          required: rest.required !== false,
        };
      });

      const formData = new FormData();
      formData.append("name", templateName || "New Document Template");
      formData.append("category", templateCategory || "nda");
      formData.append("description", templateDescription || "");
      formData.append("show_to_new_users", showToNewUsers);
      
      if (pdfFile) {
        formData.append("file", pdfFile);
      }

      let templateId = editDoc?.id;
      if (editDoc) {
        await api.nda.updateTemplate(templateId, formData);
      } else {
        if (!pdfFile) throw new Error("Please upload a PDF file.");
        const uploadResult = await api.nda.uploadTemplate(formData);
        templateId = uploadResult?.template?.id;
      }

      if (!templateId) {
        throw new Error("Template save failed.");
      }

      await api.nda.saveTemplateFields(templateId, cleanFields);

      setMessage(`Template ${editDoc ? "updated" : "saved"} successfully.`);
    } catch (e) {
      setMessage(e.message || "Failed to save NDA template.");
    } finally {
      setSaving(false);
    }
  };

  if (!isHRManager) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900">
        <div className="rounded-xl border bg-white dark:bg-slate-800 p-6 shadow">
          <p className="text-sm text-red-600 dark:text-red-400">
            Only HR managers can edit NDA templates.
          </p>
        </div>
      </div>
    );
  }


  return (
    <div className={`min-h-screen ${isDark ? "bg-slate-900 text-white" : "bg-gray-50 text-gray-900"}`}>
      <div className={`sticky top-0 z-20 border-b ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
        <div className="px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">Document Template Builder</h1>
            <p className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}>
              Upload a PDF, specify document details, and place signature/input boxes.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (onBack) {
                  onBack();
                } else {
                  window.location.hash = "user-management";
                  window.location.href = "/";
                }
              }}
              className={`px-4 py-2 rounded-lg border text-sm font-medium ${isDark ? "border-slate-600 text-gray-300 hover:bg-slate-700" : "border-gray-300 text-gray-700 hover:bg-gray-100"}`}
            >
              Back
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="px-5 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-semibold disabled:opacity-50"
            >
              {saving ? "Saving..." : (editDoc ? "Update Template" : "Save Template")}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-5 p-5">
        <aside className={`rounded-xl border p-4 space-y-4 ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
          <div>
            <label className="block text-sm font-medium mb-1">Document Title</label>
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Category</label>
            <select
              value={templateCategory}
              onChange={(e) => setTemplateCategory(e.target.value)}
              className={inputClass}
            >
              <option value="nda">NDA / Legal</option>
              <option value="policy">Policy</option>
              <option value="onboarding">Onboarding</option>
              <option value="general">General</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description (Optional)</label>
            <input
              type="text"
              value={templateDescription}
              onChange={(e) => setTemplateDescription(e.target.value)}
              className={inputClass}
              placeholder="Brief description of the document"
            />
          </div>

          <label className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer ${showToNewUsers ? isDark ? 'border-brand/50 bg-brand/10' : 'border-brand/30 bg-brand/5' : isDark ? 'border-slate-600' : 'border-gray-200'}`}>
            <input type="checkbox" checked={showToNewUsers} onChange={e => setShowToNewUsers(e.target.checked)} className="h-4 w-4 accent-brand" />
            <div>
              <p className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>Show to new users on login</p>
              <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Highlight for new employees.</p>
            </div>
          </label>

          <div>
            <label className="block text-sm font-medium mb-1">Upload PDF</label>
            <input
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              className={`${inputClass} !p-1.5 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-brand/10 file:text-brand`}
            />
            <p className={`text-xs mt-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}>
              Only PDF format is supported for interactive drawing.
            </p>
          </div>

          <div className="pt-2 border-t dark:border-slate-700">
            <label className="block text-sm font-medium mb-1">Field Box</label>
            <select
              value={selectedFieldKey}
              onChange={(e) => setSelectedFieldKey(e.target.value)}
              className={inputClass}
            >
              {FIELD_OPTIONS.map((f) => (
                <option key={f.field_key} value={f.field_key}>
                  {f.field_label} {f.field_key !== "custom" && `(${f.signer_role})`}
                </option>
              ))}
            </select>
          </div>

          {selectedFieldKey === "custom" && (
            <div className="space-y-3 pl-3 border-l-2 border-brand/50 mt-2">
              <div>
                <label className="block text-xs font-medium mb-1">Label</label>
                <input type="text" value={customFieldLabel} onChange={e => setCustomFieldLabel(e.target.value)} placeholder="e.g. Work Email" className={inputClass} />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1">Type</label>
                  <select value={customFieldType} onChange={e => setCustomFieldType(e.target.value)} className={inputClass}>
                    <option value="text">Text Box</option>
                    <option value="signature">Signature</option>
                    <option value="initials">Initials</option>
                    <option value="date">Date</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1">Assigned To</label>
                  <select value={customFieldRole} onChange={e => setCustomFieldRole(e.target.value)} className={inputClass}>
                    <option value="employee">Employee</option>
                    <option value="shree">Shree (Admin)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

            <button
              type="button"
              disabled={(!pdfFile && !editDoc) || Object.keys(pageMetrics).length === 0 || isAddingBox}
              onClick={handleAddBoxClick}
              className={`mt-2 w-full rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${isAddingBox ? "bg-amber-500 hover:bg-amber-600" : "bg-brand hover:bg-brand-hover"}`}
            >
              {isAddingBox ? "Click PDF to Place..." : "Add Box"}
            </button>
            {isAddingBox && (
              <button
                type="button"
                onClick={() => {
                  setIsAddingBox(false);
                  setMessage("Box addition cancelled.");
                }}
                className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
            )}

          <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
            <p className="text-sm font-semibold mb-2">All Placed Boxes</p>

            {fields.length === 0 ? (
              <p className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                No boxes added yet.
              </p>
            ) : (
              <div className="space-y-2">
                {fields.map((field) => (
                  <div
                    key={field.id}
                    className={`rounded-lg border p-2 text-xs ${isDark ? "border-slate-600 bg-slate-700/50" : "border-gray-200 bg-gray-50"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold">{field.field_label} <span className="text-gray-400 font-normal text-xs">(Page {field.page_number})</span></p>
                        <p className={isDark ? "text-gray-400" : "text-gray-500"}>
                          {field.signer_role} • {field.field_type}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeField(field.id)}
                        className="text-red-500 text-xs font-semibold"
                      >
                        Remove
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <input
                        type="number"
                        value={field.width}
                        onChange={(e) =>
                          updateField(field.id, { width: Number(e.target.value) })
                        }
                        className={inputClass}
                        placeholder="Width"
                      />

                      <input
                        type="number"
                        value={field.height}
                        onChange={(e) =>
                          updateField(field.id, { height: Number(e.target.value) })
                        }
                        className={inputClass}
                        placeholder="Height"
                      />
                    </div>

                    <div className={`mt-2 text-[11px] ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                      <p>x: {field.x}, y: {field.y}</p>
                      <p>viewer: {field.viewer_width || "--"} × {field.viewer_height || "--"}</p>
                      <p>pdf: {field.pdf_width || "--"} × {field.pdf_height || "--"}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {message && (
            <p className={`text-sm rounded-lg p-3 ${message.includes("success") ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300" : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"}`}>
              {message}
            </p>
          )}
        </aside>

        <main className={`rounded-xl border overflow-auto ${isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"}`}>
          {!pdfUrl ? (
            <div className="min-h-[700px] flex items-center justify-center">
              <p className={isDark ? "text-gray-400" : "text-gray-500"}>
                Upload an NDA PDF to start placing boxes.
              </p>
            </div>
          ) : (
            <div className="p-5 flex flex-col items-center gap-8">
              <Document
                file={pdfUrl}
                onLoadSuccess={async (pdf) => {
                  setNumPages(pdf.numPages);
                  await loadAllPageMetrics(pdf);
                  setMessage("");
                }}
                onLoadError={(err) => {
                  console.error("PDF load error:", err);
                  setMessage("Failed to load PDF. Please upload a valid PDF file.");
                }}
                loading={
                  <div className="w-[850px] min-h-[700px] flex items-center justify-center bg-white text-gray-500">
                    Loading PDF...
                  </div>
                }
                error={
                  <div className="w-[850px] min-h-[700px] flex items-center justify-center bg-white text-red-600">
                    Failed to load PDF file.
                  </div>
                }
              >
                {Array.from(new Array(numPages), (el, index) => index + 1).map((pageNum) => (
                  <div
                    key={`page_${pageNum}`}
                    className={`relative shadow-lg mb-8 ${isAddingBox ? "cursor-crosshair" : ""}`}
                    style={{
                      width: VIEWER_WIDTH,
                      minHeight: pageMetrics[pageNum]?.viewer_height || 700,
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDrop(e, pageNum)}
                    onClick={(e) => handlePdfClick(e, pageNum)}
                  >
                    <Page
                      pageNumber={pageNum}
                      width={VIEWER_WIDTH}
                      renderAnnotationLayer={false}
                      renderTextLayer={false}
                    />

                    {fields.filter(f => f.page_number === pageNum).map((field) => (
                      <div
                        key={field.id}
                        draggable={!resizingField}
                        onDragStart={(e) => handleDragStart(e, field)}
                        style={{
                          position: "absolute",
                          left: field.x,
                          top: field.y,
                          width: field.width,
                          height: field.height,
                        }}
                        className={`group cursor-move rounded border-2 text-xs font-semibold flex items-center justify-center text-center ${
                          field.signer_role === "employee"
                            ? "border-blue-500 bg-blue-100/70 text-blue-800"
                            : "border-purple-500 bg-purple-100/70 text-purple-800"
                        }`}
                        title="Drag to move, use bottom-right corner to resize"
                      >
                        <span className="pointer-events-none select-none">{field.field_label}</span>
                        
                        <div
                          className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize bg-black/20 hover:bg-black/40 rounded-tl opacity-0 group-hover:opacity-100 transition-opacity"
                          onMouseDown={(e) => handleResizeStart(e, field)}
                          title="Drag to resize"
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </Document>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}