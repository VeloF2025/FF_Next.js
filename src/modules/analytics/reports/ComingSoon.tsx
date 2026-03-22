// 🟢 WORKING: Placeholder component for reports not yet implemented
export default function ComingSoon({ name }: { name: string }) {
  return (
    <div className="p-8 text-center text-gray-400">
      <p className="text-lg font-medium text-gray-300">{name}</p>
      <p className="text-sm mt-2">Coming soon</p>
    </div>
  );
}
