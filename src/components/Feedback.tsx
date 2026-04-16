import { useState } from "react";
import { Star, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { useSearchParams } from "react-router-dom"; 
import { feedbackAPI } from "../utils/api";

export function Feedback() {
  const [searchParams] = useSearchParams();
  const busId = searchParams.get("busId") || "";

  const [name, setName] = useState("");
  const [driverRating, setDriverRating] = useState(0);
  const [conductorRating, setConductorRating] = useState(0);
  const [message, setMessage] = useState("");

  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const StarRating = ({
    rating,
    setRating,
  }: {
    rating: number;
    setRating: (v: number) => void;
  }) => (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          onClick={() => setRating(star)}
          className={`h-6 w-6 cursor-pointer transition ${
            star <= rating
              ? "fill-yellow-400 text-yellow-400"
              : "text-gray-300 hover:text-yellow-400"
          }`}
        />
      ))}
    </div>
  );

  const handleSubmit = async () => {
    if (driverRating === 0 || conductorRating === 0) {
      setErrorMsg("Please rate both the driver and conductor.");
      setStatus("error");
      return;
    }

    setStatus("loading");
    setErrorMsg("");

    try {
      await feedbackAPI.submit({ busId, name, driverRating, conductorRating, message });
      setStatus("success");
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to submit feedback.");
      setStatus("error");
    }
  };

  if (status === "success") {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg p-8 flex flex-col items-center gap-4 text-center">
          <CheckCircle className="h-16 w-16 text-green-500" />
          <h2 className="text-2xl font-bold text-gray-800">Thank you!</h2>
          <p className="text-gray-500">
            Your feedback for Bus <span className="font-semibold">{busId}</span> has been submitted.
          </p>
          <button
            onClick={() => {
              setStatus("idle");
              setName("");
              setDriverRating(0);
              setConductorRating(0);
              setMessage("");
            }}
            className="mt-2 px-6 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition"
          >
            Submit Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Feedback</h1>
          <p className="text-gray-500 text-sm">
            Help us improve by sharing your experience
            {busId && (
              <span className="ml-1">
                for <span className="font-medium text-indigo-600">Bus {busId}</span>
              </span>
            )}
            .
          </p>
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="text-sm font-medium text-gray-700">Name (optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Anonymous"
              className="mt-1 w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          {/* Driver Rating */}
          <div>
            <label className="text-sm font-medium text-gray-700">Driver Rating</label>
            <div className="mt-1">
              <StarRating rating={driverRating} setRating={setDriverRating} />
            </div>
          </div>

          {/* Conductor Rating */}
          <div>
            <label className="text-sm font-medium text-gray-700">Conductor Rating</label>
            <div className="mt-1">
              <StarRating rating={conductorRating} setRating={setConductorRating} />
            </div>
          </div>

          {/* Message */}
          <div>
            <label className="text-sm font-medium text-gray-700">Feedback Message (optional)</label>
            <textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write your feedback..."
              className="mt-1 w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          {/* Error */}
          {status === "error" && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {errorMsg}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={status === "loading"}
            className="w-full py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {status === "loading" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              "Submit Feedback"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}