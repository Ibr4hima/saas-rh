/** Une adresse qui ne tient pas sur la ligne se coupe après l'arobase, pas au milieu d'un mot. */
export function Courriel({ adresse }: { adresse: string }) {
  const arobase = adresse.indexOf('@');
  return (
    <a
      href={`mailto:${adresse}`}
      className="break-words transition-colors hover:text-primary hover:underline"
    >
      {arobase < 0 ? (
        adresse
      ) : (
        <>
          {adresse.slice(0, arobase + 1)}
          <wbr />
          {adresse.slice(arobase + 1)}
        </>
      )}
    </a>
  );
}
