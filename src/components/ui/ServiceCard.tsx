interface ServiceCardProps {
  title: string;
  items: readonly string[];
}

export default function ServiceCard({ title, items }: ServiceCardProps) {
  return (
    <div className="bg-[#fdfaf6] border border-gray-200 rounded-lg p-6 flex flex-col">
      <div className="flex items-center">
        <div className="w-10 h-10 rounded-full bg-[#f39c12] flex items-center justify-center shrink-0">
          <svg
            className="w-6 h-6 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h4 className="ml-4 text-lg font-semibold text-[#333]">{title}</h4>
      </div>
      <ul className="mt-5 text-base text-[#555] space-y-3">
        {items.map((item, index) => (
          <li key={index}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}
