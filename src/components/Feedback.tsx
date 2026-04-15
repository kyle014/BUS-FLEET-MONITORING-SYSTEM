import { useState } from "react";
import { Star } from "lucide-react";

export function Feedback() {
  const [driverRating, setDriverRating] = useState(0);
  const [conductorRating, setConductorRating] = useState(0);

  const StarRating = ({ rating, setRating }: any) => (
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

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Feedback</h1>
          <p className="text-gray-500 text-sm">
            Help us improve by sharing your experience.
          </p>
        </div>

        <form className="space-y-4">
          {/* Name */}
          <div>
            <label className="text-sm font-medium text-gray-700">Name</label>
            <input
              type="text"
              placeholder="Anonymous012"
              className="mt-1 w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          {/* Driver Rating */}
          <div>
            <label className="text-sm font-medium text-gray-700">
              Driver Rating
            </label>
            <StarRating rating={driverRating} setRating={setDriverRating} />
          </div>

          {/* Conductor Rating */}
          <div>
            <label className="text-sm font-medium text-gray-700">
              Conductor Rating
            </label>
            <StarRating rating={conductorRating} setRating={setConductorRating} />
          </div>

          {/* Message */}
          <div>
            <label className="text-sm font-medium text-gray-700">
              Feedback Message
            </label>
            <textarea
              rows={4}
              placeholder="Write your feedback..."
              className="mt-1 w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            className="w-full py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition"
          >
            Submit Feedback
          </button>
        </form>
      </div>
    </div>
  );
}