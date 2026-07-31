export default function ConnectionsIndex() {
  return null;
}

export const getServerSideProps = async () => ({
  redirect: {
    destination: '/connections/fibreflow',
    permanent: false,
  },
});
