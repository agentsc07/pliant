const STORIES = ["Maya", "Ravi", "Anya", "Dev", "Priya", "Kabir"];

export function StoriesBar() {
  return (
    <div className="stories" data-testid="stories">
      {STORIES.map((n) => (
        <div key={n} className="story">
          <div className="story-ring"><span>{n[0]}</span></div>
          <span>{n}</span>
        </div>
      ))}
    </div>
  );
}
