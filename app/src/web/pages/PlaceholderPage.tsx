type PlaceholderPageProps = {
  title: string;
  text: string;
};

export function PlaceholderPage({ title, text }: PlaceholderPageProps) {
  return (
    <section className="placeholder">
      <h1 className="placeholder__title">{title}</h1>
      <p className="placeholder__text">{text}</p>
    </section>
  );
}
