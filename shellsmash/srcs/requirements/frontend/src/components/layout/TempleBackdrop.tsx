interface TempleBackdropProps {
  pageClassName: string;
}

export function TempleBackdrop({ pageClassName }: TempleBackdropProps): JSX.Element {
  return (
    <div className={`${pageClassName}__backdrop`} aria-hidden="true">
      <div className={`${pageClassName}__sun`} />
      <div className={`${pageClassName}__grid`} />
    </div>
  );
}
