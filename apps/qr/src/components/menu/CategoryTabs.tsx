import { useMenu } from '../../context/MenuContext.tsx';

export function CategoryTabs() {
  const { categories, activeCategoryId, setActiveCategoryId } = useMenu();

  return (
    <div className="sticky top-0 z-10 bg-[#FFF6EE] border-b border-[#E8D5C0] overflow-x-auto no-scrollbar">
      <div className="flex gap-1 px-4 py-2 min-w-max">
        {categories.map((cat) => {
          const active = cat._id === activeCategoryId;
          return (
            <button
              key={cat._id}
              onClick={() => setActiveCategoryId(cat._id)}
              className={[
                'px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors',
                active
                  ? 'bg-[#E8380D] text-white'
                  : 'bg-white text-[#1C0800] border border-[#E8D5C0]',
              ].join(' ')}
            >
              {cat.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
